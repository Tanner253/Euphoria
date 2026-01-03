/**
 * POST /api/bets/place
 * Server-authoritative bet placement
 * 
 * SECURITY: 
 * - Validates balance from database (not client)
 * - Uses server-side price (not client-provided)
 * - Records bet with server timestamp
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedWallet } from '@/lib/auth/jwt';
import { BetService, UserService } from '@/lib/db/services';
import { getServerPrice } from '@/lib/services/PriceService';
import logger from '@/lib/utils/secureLogger';

// Bet amount limits
const MIN_BET = 1;
const MAX_BET = 100; // Max 100 gems per bet

// Valid multiplier range
const MIN_MULTIPLIER = 1.01;
const MAX_MULTIPLIER = 50;

// Base price per cell at 1x zoom - MUST match client: CELL_SIZE / PRICE_SCALE = 50/2500 = 0.02
// Actual price per cell is calculated dynamically based on zoom level
const PRICE_PER_CELL = 0.02;

// Max allowed offset from price (prevents absurd bets)
const MAX_BET_OFFSET = 100;

interface PlaceBetRequest {
  sessionId: string;
  columnId: string;
  yIndex: number;
  basePrice: number;           // Client's basePrice - anchor for grid coordinates
  cellSize: number;            // Effective cell size (with zoom applied)
  amount: number;
  multiplier: number;
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
    
    // 2. Parse and validate request
    const body: PlaceBetRequest = await request.json();
    const { sessionId, columnId, yIndex, basePrice, cellSize, amount, multiplier } = body;
    
    // Validate required fields
    if (!sessionId || !columnId || yIndex === undefined || !amount || !multiplier || 
        basePrice === undefined || cellSize === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Validate cellSize is reasonable (25-150 covers all zoom levels)
    if (cellSize < 25 || cellSize > 150) {
      return NextResponse.json(
        { error: 'Invalid cell size' },
        { status: 400 }
      );
    }
    
    // Validate amount
    if (typeof amount !== 'number' || amount < MIN_BET || amount > MAX_BET) {
      return NextResponse.json(
        { error: `Bet amount must be between ${MIN_BET} and ${MAX_BET}` },
        { status: 400 }
      );
    }
    
    // Validate multiplier
    if (typeof multiplier !== 'number' || multiplier < MIN_MULTIPLIER || multiplier > MAX_MULTIPLIER) {
      return NextResponse.json(
        { error: 'Invalid multiplier' },
        { status: 400 }
      );
    }
    
    // 3. Get user and validate balance (SERVER-AUTHORITATIVE)
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
    
    // CRITICAL: Check balance from DATABASE
    if (user.gemsBalance < amount) {
      return NextResponse.json(
        { error: 'Insufficient balance', balance: user.gemsBalance },
        { status: 400 }
      );
    }
    
    // 4. Get SERVER price for validation
    const priceData = await getServerPrice();
    const serverPrice = priceData.price;
    
    // 5. Validate basePrice is reasonable (within $5 of server price)
    const priceDrift = Math.abs(basePrice - serverPrice);
    if (priceDrift > 5.0) {
      logger.warn('[Bet] BasePrice too far from server price', {
        basePrice,
        serverPrice,
        drift: priceDrift.toFixed(4),
      });
      return NextResponse.json(
        { error: 'Price sync error - please refresh' },
        { status: 400 }
      );
    }
    
    // 6. Calculate GRID-ALIGNED win price boundaries
    // These boundaries match EXACTLY to the cell at yIndex
    // Formula: priceY = -(price - basePrice) * PRICE_SCALE + cellSize/2
    // For cell yIndex: yIndex * cellSize <= priceY < (yIndex + 1) * cellSize
    // Solving for price boundaries:
    const PRICE_SCALE = 2500;  // Must match GAME_CONFIG.PRICE_SCALE
    const pricePerPixel = 1 / PRICE_SCALE;
    
    // Cell spans from y = yIndex * cellSize to y = (yIndex + 1) * cellSize
    // Convert Y boundaries to price boundaries
    // priceY = -(price - basePrice) * PRICE_SCALE + cellSize/2
    // Solving: price = basePrice + (cellSize/2 - priceY) / PRICE_SCALE
    const cellYTop = yIndex * cellSize;
    const cellYBottom = (yIndex + 1) * cellSize;
    
    // When priceY = cellYTop, price = basePrice + (cellSize/2 - cellYTop) / PRICE_SCALE
    // When priceY = cellYBottom, price = basePrice + (cellSize/2 - cellYBottom) / PRICE_SCALE
    // Note: higher Y = lower price (inverted)
    const winPriceMax = basePrice + (cellSize / 2 - cellYTop) / PRICE_SCALE;
    const winPriceMin = basePrice + (cellSize / 2 - cellYBottom) / PRICE_SCALE;
    
    logger.info('[Bet] Grid-aligned win boundaries', {
      yIndex,
      basePrice,
      serverPrice,
      cellSize,
      winPriceMin: winPriceMin.toFixed(4),
      winPriceMax: winPriceMax.toFixed(4),
    });
    
    // 7. Place the bet with GRID-ALIGNED win boundaries
    const betService = BetService.getInstance();
    const result = await betService.placeBet({
      walletAddress,
      sessionId,
      amount,
      multiplier: Math.round(multiplier * 100) / 100, // Round to 2 decimals
      columnId,
      yIndex,
      basePrice,    // Store for resolution reference
      cellSize,     // Store for resolution reference
      priceAtBet: serverPrice,
      winPriceMin,  // Grid-aligned boundaries
      winPriceMax,  // Grid-aligned boundaries
    });
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to place bet' },
        { status: 400 }
      );
    }
    
    // Fetch FRESH balance after bet placement (balance was deducted in placeBet)
    const updatedUser = await userService.getUser(walletAddress);
    const newBalance = updatedUser?.gemsBalance ?? (user.gemsBalance - amount);
    
    logger.info('[Bet] Placed', {
      wallet: walletAddress.slice(0, 8),
      amount,
      multiplier: multiplier.toFixed(2),
      newBalance,
    });
    
    return NextResponse.json({
      success: true,
      bet: {
        id: result.bet?._id?.toString(),
        amount: result.bet?.amount,
        multiplier: result.bet?.multiplier,
        potentialWin: result.bet?.potentialWin,
        priceAtBet: serverPrice,
        winPriceMin,  // For client visualization (not used for win determination)
        winPriceMax,
        status: 'pending',
      },
      newBalance,
    });
    
  } catch (error) {
    logger.error('[API] Place bet error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

