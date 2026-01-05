/**
 * POST /api/bets/place-batch
 * Batch bet placement for drag mode - single request for multiple bets
 * 
 * OPTIMIZATION: Instead of 10 HTTP requests, send 1 with all bets
 * Reduces latency by ~90% for drag-mode betting
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedWallet } from '@/lib/auth/jwt';
import { BetService, UserService } from '@/lib/db/services';
import { getServerPrice } from '@/lib/services/PriceService';
import logger from '@/lib/utils/secureLogger';

const MIN_BET = 1;
const MAX_BET = 100;
const MAX_BATCH_SIZE = 50; // Max bets per batch
const PRICE_SCALE = 2500;

interface BatchBet {
  columnId: string;
  yIndex: number;
  basePrice: number;
  cellSize: number;
  amount: number;
  multiplier: number;
}

interface BatchBetRequest {
  sessionId: string;
  bets: BatchBet[];
}

interface BetResult {
  index: number;
  success: boolean;
  betId?: string;
  winPriceMin?: number;
  winPriceMax?: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const authHeader = request.headers.get('authorization');
    const walletAddress = getAuthenticatedWallet(authHeader);
    
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // 2. Parse request
    const body: BatchBetRequest = await request.json();
    const { sessionId, bets } = body;
    
    if (!sessionId || !bets || !Array.isArray(bets)) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    if (bets.length === 0) {
      return NextResponse.json(
        { error: 'No bets provided' },
        { status: 400 }
      );
    }
    
    if (bets.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BATCH_SIZE} bets per batch` },
        { status: 400 }
      );
    }
    
    // 3. Get user and validate total balance
    const userService = UserService.getInstance();
    const user = await userService.getUser(walletAddress);
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    
    if (user.status !== 'active') {
      return NextResponse.json(
        { error: 'Account is suspended' },
        { status: 403 }
      );
    }
    
    // Calculate total amount needed
    const totalAmount = bets.reduce((sum, bet) => sum + bet.amount, 0);
    
    if (user.gemsBalance < totalAmount) {
      return NextResponse.json(
        { error: 'Insufficient balance for batch', balance: user.gemsBalance, required: totalAmount },
        { status: 400 }
      );
    }
    
    // 4. Get server price for validation
    const priceData = await getServerPrice();
    const serverPrice = priceData.price;
    
    // 5. Validate all bets first (no DB operations yet)
    const validBets: Array<{
      index: number;
      columnId: string;
      yIndex: number;
      basePrice: number;
      cellSize: number;
      amount: number;
      multiplier: number;
      winPriceMin: number;
      winPriceMax: number;
    }> = [];
    const results: BetResult[] = [];
    
    for (let i = 0; i < bets.length; i++) {
      const bet = bets[i];
      
      // Validate individual bet
      if (!bet.columnId || bet.yIndex === undefined || 
          bet.basePrice === undefined || bet.cellSize === undefined ||
          !bet.amount || !bet.multiplier) {
        results.push({ index: i, success: false, error: 'Missing fields' });
        continue;
      }
      
      if (bet.amount < MIN_BET || bet.amount > MAX_BET) {
        results.push({ index: i, success: false, error: `Amount must be ${MIN_BET}-${MAX_BET}` });
        continue;
      }
      
      if (bet.cellSize < 25 || bet.cellSize > 150) {
        results.push({ index: i, success: false, error: 'Invalid cell size' });
        continue;
      }
      
      // Validate basePrice
      const priceDrift = Math.abs(bet.basePrice - serverPrice);
      if (priceDrift > 5.0) {
        results.push({ index: i, success: false, error: 'Price sync error' });
        continue;
      }
      
      // Validate yIndex is reasonable
      const MAX_Y_INDEX = 100;
      const MIN_Y_INDEX = -100;
      if (bet.yIndex < MIN_Y_INDEX || bet.yIndex > MAX_Y_INDEX) {
        results.push({ index: i, success: false, error: 'Invalid bet position' });
        continue;
      }
      
      // Calculate grid-aligned win boundaries
      const cellYTop = bet.yIndex * bet.cellSize;
      const cellYBottom = (bet.yIndex + 1) * bet.cellSize;
      const winPriceMax = bet.basePrice + (bet.cellSize / 2 - cellYTop) / PRICE_SCALE;
      const winPriceMin = bet.basePrice + (bet.cellSize / 2 - cellYBottom) / PRICE_SCALE;
      
      // Add to valid bets for batch insert
      validBets.push({
        index: i,
        columnId: bet.columnId,
        yIndex: bet.yIndex,
        basePrice: bet.basePrice,
        cellSize: bet.cellSize,
        amount: bet.amount,
        multiplier: Math.round(bet.multiplier * 100) / 100,
        winPriceMin,
        winPriceMax,
      });
    }
    
    // 6. OPTIMIZED: Single batch insert for all valid bets
    let successCount = 0;
    let totalDeducted = 0;
    
    if (validBets.length > 0) {
      const betService = BetService.getInstance();
      const batchResult = await betService.placeBetBatch(
        walletAddress,
        sessionId,
        serverPrice,
        validBets.map(vb => ({
          columnId: vb.columnId,
          yIndex: vb.yIndex,
          basePrice: vb.basePrice,
          cellSize: vb.cellSize,
          amount: vb.amount,
          multiplier: vb.multiplier,
          winPriceMin: vb.winPriceMin,
          winPriceMax: vb.winPriceMax,
        }))
      );
      
      if (batchResult.success) {
        // Map batch results back to original indices
        batchResult.results.forEach((br, idx) => {
          const originalIndex = validBets[idx].index;
        results.push({
            index: originalIndex,
            success: br.success,
            betId: br.betId,
            winPriceMin: validBets[idx].winPriceMin,
            winPriceMax: validBets[idx].winPriceMax,
        });
          if (br.success) successCount++;
        });
        totalDeducted = batchResult.totalDeducted;
      } else {
        // Batch failed - mark all as failed
        validBets.forEach(vb => {
          results.push({ index: vb.index, success: false, error: batchResult.error || 'Batch failed' });
        });
      }
    }
    
    // Sort results by original index
    results.sort((a, b) => a.index - b.index);
    
    // 7. Calculate new balance
    const newBalance = user.gemsBalance - totalDeducted;
    
    logger.info('[Bet Batch] Processed', {
      wallet: walletAddress.slice(0, 8),
      total: bets.length,
      success: successCount,
      failed: bets.length - successCount,
      totalDeducted,
      newBalance,
    });
    
    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: bets.length,
        successful: successCount,
        failed: bets.length - successCount,
        totalDeducted,
      },
      newBalance,
    });
    
  } catch (error) {
    logger.error('[API] Batch bet error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

