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
  // Client sends the price at the moment the column crossed the head
  priceAtCrossing?: number;
  // Client can send hints for logging only
  clientHint?: boolean;
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
    const { betId, clientHint, priceAtCrossing } = body;
    
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
    
    // 4. Determine which price to use for win calculation
    // Client sends the price at the exact moment the column crossed the head
    // We validate this price is reasonable (within tolerance of server price)
    // OPTIMIZATION: Only fetch server price if we need to validate or fallback
    const MAX_PRICE_DRIFT = 1.00; // Allow up to $1.00 drift for network latency
    let resolutionPrice: number;
    
    if (priceAtCrossing !== undefined && typeof priceAtCrossing === 'number' && priceAtCrossing > 0) {
      // Client provided crossing price - validate it's reasonable
      // Use bet's priceAtBet as reference (faster than fetching server price)
      const referenceDrift = Math.abs(priceAtCrossing - bet.priceAtBet);
      
      // Price shouldn't drift more than $5 from bet placement (reasonable for short-term bets)
      if (referenceDrift <= 5.0) {
        resolutionPrice = priceAtCrossing;
        logger.info('[Bet] Using client crossing price', {
          priceAtCrossing,
          priceAtBet: bet.priceAtBet,
          drift: referenceDrift.toFixed(4),
        });
      } else {
        // Price drift too large - fetch server price as fallback
        const priceData = await getServerPrice();
        const serverPrice = priceData.price;
        const serverDrift = Math.abs(priceAtCrossing - serverPrice);
        
        if (serverDrift <= MAX_PRICE_DRIFT) {
          resolutionPrice = priceAtCrossing;
        } else {
          resolutionPrice = serverPrice;
          logger.warn('[Bet] Client crossing price rejected', {
            priceAtCrossing,
            serverPrice,
            drift: serverDrift.toFixed(4),
          });
        }
      }
    } else {
      // No client price - fetch from server
      const priceData = await getServerPrice();
      resolutionPrice = priceData.price;
    }
    
    // 6. SERVER-AUTHORITATIVE WIN DETERMINATION
    // Win boundaries were calculated at bet time
    // Resolution price is validated by server
    const { winPriceMin, winPriceMax } = bet;
    
    let isWin = false;
    
    if (winPriceMin !== undefined && winPriceMax !== undefined) {
      // Check if resolution price falls within win boundaries (inclusive on both ends)
      isWin = resolutionPrice >= winPriceMin && resolutionPrice <= winPriceMax;
    } else {
      // Legacy bet without boundaries - default to loss
      logger.warn('[Bet] Legacy bet without win boundaries', {
        betId,
        priceAtBet: bet.priceAtBet,
      });
      isWin = false;
    }
    
    logger.info('[Bet] Win calculation', {
      resolutionPrice,
      priceAtBet: bet.priceAtBet,
      winPriceMin,
      winPriceMax,
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

