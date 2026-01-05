/**
 * POST /api/bets/resolve
 * 100% SERVER-AUTHORITATIVE bet resolution
 * 
 * SECURITY:
 * - Win boundaries were calculated by SERVER at bet placement time
 * - Server gets current price from SERVER (not client)
 * - Win is determined by checking if current price is within stored boundaries
 * - CLIENT HAS ZERO INFLUENCE ON WIN DETERMINATION
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedWallet } from '@/lib/auth/jwt';
import { BetService } from '@/lib/db/services';
import { getServerPrice } from '@/lib/services/PriceService';
import logger from '@/lib/utils/secureLogger';

interface ResolveBetRequest {
  betId: string;
  // Client-observed price range during column crossing
  // Used for "touch" win detection - line touching cell at ANY point = win
  priceAtCrossing?: number;      // Center price (legacy support)
  priceRangeMin?: number;        // Lowest price line reached in column
  priceRangeMax?: number;        // Highest price line reached in column
  clientHint?: boolean;          // Client's win determination (for debugging)
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
    const body: ResolveBetRequest = await request.json();
    const { betId, clientHint, priceAtCrossing, priceRangeMin, priceRangeMax } = body;
    
    if (!betId) {
      return NextResponse.json(
        { error: 'Missing bet ID' },
        { status: 400 }
      );
    }
    
    // 3. Get the bet (includes server-calculated win boundaries)
    const betService = BetService.getInstance();
    const bet = await betService.getBet(betId);
    
    if (!bet) {
      return NextResponse.json(
        { error: 'Bet not found' },
        { status: 404 }
      );
    }
    
    // SECURITY: Verify bet belongs to authenticated user
    if (bet.walletAddress !== walletAddress) {
      logger.warn('[Bet] Resolve attempt for another user\'s bet', {
        wallet: walletAddress.slice(0, 8),
        betOwner: bet.walletAddress.slice(0, 8),
      });
      
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }
    
    // Check if already resolved
    if (bet.status !== 'pending') {
      return NextResponse.json({
        success: true,
        bet: {
          id: bet._id?.toString(),
          status: bet.status,
          actualWin: bet.actualWin || 0,
          priceAtResolution: bet.priceAtResolution,
        },
        alreadyResolved: true,
      });
    }
    
    // 4. TOUCH-BASED WIN DETECTION
    // The client sends the price RANGE the line traveled through the column
    // Win if the price range OVERLAPS with the bet's win range at ANY point
    // This is more intuitive - if the line "touched" the cell, you win!
    
    const priceData = await getServerPrice();
    const serverPrice = priceData.price;
    
    // SECURITY: Validate client price range is reasonable
    // Max range width of $2 prevents fabricated wide ranges
    // Max drift of $0.50 from server price prevents stale/manipulated data
    const MAX_RANGE_WIDTH = 2.0;   // Max $2 swing within one column (very volatile)
    const MAX_CENTER_DRIFT = 0.50; // Center price must be within $0.50 of server
    
    let clientPriceMin: number | undefined;
    let clientPriceMax: number | undefined;
    let resolutionPrice = serverPrice; // For logging/storage
    
    // Validate and accept client price range
    if (priceRangeMin !== undefined && priceRangeMax !== undefined && 
        typeof priceRangeMin === 'number' && typeof priceRangeMax === 'number' &&
        priceRangeMin > 0 && priceRangeMax > 0) {
      
      const rangeWidth = priceRangeMax - priceRangeMin;
      const rangeCenter = (priceRangeMin + priceRangeMax) / 2;
      const centerDrift = Math.abs(rangeCenter - serverPrice);
      
      if (rangeWidth <= MAX_RANGE_WIDTH && centerDrift <= MAX_CENTER_DRIFT) {
        // Client range is reasonable - accept it
        clientPriceMin = priceRangeMin;
        clientPriceMax = priceRangeMax;
        resolutionPrice = rangeCenter;
        logger.info('[Bet] Using client price range (validated)', {
          clientMin: priceRangeMin.toFixed(4),
          clientMax: priceRangeMax.toFixed(4),
          serverPrice: serverPrice.toFixed(4),
          rangeWidth: rangeWidth.toFixed(4),
          centerDrift: centerDrift.toFixed(4),
        });
      } else {
        // Range too wide or center too far from server - reject
        logger.warn('[Bet] Client price range rejected', {
          clientMin: priceRangeMin.toFixed(4),
          clientMax: priceRangeMax.toFixed(4),
          serverPrice: serverPrice.toFixed(4),
          rangeWidth: rangeWidth.toFixed(4),
          centerDrift: centerDrift.toFixed(4),
          reason: rangeWidth > MAX_RANGE_WIDTH ? 'range too wide' : 'center drift too high',
        });
      }
    } else if (priceAtCrossing !== undefined && typeof priceAtCrossing === 'number' && priceAtCrossing > 0) {
      // Legacy single-price support
      const centerDrift = Math.abs(priceAtCrossing - serverPrice);
      if (centerDrift <= MAX_CENTER_DRIFT) {
        clientPriceMin = priceAtCrossing;
        clientPriceMax = priceAtCrossing;
        resolutionPrice = priceAtCrossing;
        logger.info('[Bet] Using legacy single price', {
          clientPrice: priceAtCrossing.toFixed(4),
          serverPrice: serverPrice.toFixed(4),
          });
        }
    }
    
    // 6. SERVER-AUTHORITATIVE WIN DETERMINATION
    // TOUCH mechanic: Win if price range OVERLAPS with bet's win range
    const { winPriceMin, winPriceMax } = bet;
    
    let isWin = false;
    
    if (winPriceMin !== undefined && winPriceMax !== undefined) {
      if (clientPriceMin !== undefined && clientPriceMax !== undefined) {
        // TOUCH detection: Ranges overlap if neither is completely above or below the other
        isWin = clientPriceMin <= winPriceMax && clientPriceMax >= winPriceMin;
      } else {
        // Fallback: Use server price as a single point
        isWin = serverPrice >= winPriceMin && serverPrice <= winPriceMax;
      }
    } else {
      // Legacy bet without boundaries - default to loss
      logger.warn('[Bet] Legacy bet without win boundaries', {
        betId,
        priceAtBet: bet.priceAtBet,
      });
      isWin = false;
    }
    
    logger.info('[Bet] Win calculation (touch detection)', {
      clientPriceRange: clientPriceMin && clientPriceMax 
        ? `${clientPriceMin.toFixed(4)} - ${clientPriceMax.toFixed(4)}` 
        : 'none (using server)',
      serverPrice: serverPrice.toFixed(4),
      winRange: `${winPriceMin?.toFixed(4)} - ${winPriceMax?.toFixed(4)}`,
      isWin,
      clientHint: clientHint ?? 'none',
      clientMatchesServer: clientHint === isWin,
    });
    
    // 7. Resolve the bet
    const result = await betService.resolveBet(
      betId,
      isWin,
      resolutionPrice
    );
    
    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to resolve bet' },
        { status: 500 }
      );
    }
    
    logger.info('[Bet] Resolved', {
      wallet: walletAddress.slice(0, 8),
      isWin,
      amount: bet.amount,
      payout: isWin ? bet.potentialWin : 0,
    });
    
    return NextResponse.json({
      success: true,
      bet: {
        id: bet._id?.toString(),
        status: isWin ? 'won' : 'lost',
        amount: bet.amount,
        multiplier: bet.multiplier,
        potentialWin: bet.potentialWin,
        actualWin: isWin ? bet.potentialWin : 0,
        priceAtBet: bet.priceAtBet,
        priceAtResolution: resolutionPrice,
        winPriceMin,
        winPriceMax,
      },
      isWin,
    });
    
  } catch (error) {
    logger.error('[API] Resolve bet error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/bets/resolve?betId=xxx
 * Check bet status without resolving
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const walletAddress = getAuthenticatedWallet(authHeader);
    
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const betId = searchParams.get('betId');
    
    if (!betId) {
      return NextResponse.json(
        { error: 'Missing bet ID' },
        { status: 400 }
      );
    }
    
    const betService = BetService.getInstance();
    const bet = await betService.getBet(betId);
    
    if (!bet || bet.walletAddress !== walletAddress) {
      return NextResponse.json(
        { error: 'Bet not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      bet: {
        id: bet._id?.toString(),
        status: bet.status,
        amount: bet.amount,
        multiplier: bet.multiplier,
        potentialWin: bet.potentialWin,
        actualWin: bet.actualWin || 0,
        priceAtBet: bet.priceAtBet,
        priceAtResolution: bet.priceAtResolution,
        createdAt: bet.createdAt,
        resolvedAt: bet.resolvedAt,
      },
    });
    
  } catch (error) {
    logger.error('[API] Get bet error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

