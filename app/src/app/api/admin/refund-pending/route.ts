/**
 * POST /api/admin/refund-pending
 * Refund all pending bets - use after server restart
 * 
 * In development: open access
 * In production: requires admin key
 */

import { NextRequest, NextResponse } from 'next/server';
import { BetService } from '@/lib/db/services';
import logger from '@/lib/utils/secureLogger';

// Only allow in development or with admin key
function isAuthorized(request: NextRequest): boolean {
  if (process.env.NODE_ENV === 'development') {
    return true;
  }
  
  const adminKey = request.headers.get('x-admin-key');
  const expectedKey = process.env.ADMIN_API_KEY;
  
  return !!(expectedKey && adminKey === expectedKey);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  try {
    const body = await request.json().catch(() => ({}));
    const maxAgeMinutes = body.maxAgeMinutes || 60; // Default: refund bets older than 60 mins
    
    const betService = BetService.getInstance();
    
    // Get all pending bets
    const pendingBets = await betService.getAllBets({ status: 'pending' });
    
    let refundedCount = 0;
    let totalRefunded = 0;
    const errors: string[] = [];
    
    for (const bet of pendingBets) {
      // Check if bet is old enough to refund (or refund all if maxAgeMinutes is 0)
      const ageMinutes = (Date.now() - new Date(bet.createdAt).getTime()) / (1000 * 60);
      
      if (maxAgeMinutes === 0 || ageMinutes >= maxAgeMinutes) {
        try {
          const cancelled = await betService.cancelBet(
            bet._id!.toString(),
            'Server restart recovery - bet refunded'
          );
          
          if (cancelled) {
            refundedCount++;
            totalRefunded += bet.amount;
            logger.info('[Admin] Refunded pending bet', {
              betId: bet._id?.toString().slice(0, 8),
              wallet: bet.walletAddress.slice(0, 8),
              amount: bet.amount
            });
          }
        } catch (err) {
          errors.push(`Failed to refund bet ${bet._id}: ${(err as Error).message}`);
        }
      }
    }
    
    logger.info('[Admin] Pending bets refund complete', {
      refundedCount,
      totalRefunded,
      totalPending: pendingBets.length
    });
    
    return NextResponse.json({
      success: true,
      refundedCount,
      totalRefunded,
      totalPending: pendingBets.length,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    logger.error('[Admin] Refund pending bets error', error);
    return NextResponse.json(
      { error: 'Failed to refund pending bets' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/refund-pending
 * Get count of pending bets that would be refunded
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  try {
    const betService = BetService.getInstance();
    const pendingBets = await betService.getAllBets({ status: 'pending' });
    
    const totalAmount = pendingBets.reduce((sum, bet) => sum + bet.amount, 0);
    
    return NextResponse.json({
      pendingCount: pendingBets.length,
      totalAmount,
      bets: pendingBets.map(b => ({
        id: b._id?.toString(),
        wallet: b.walletAddress.slice(0, 8) + '...',
        amount: b.amount,
        createdAt: b.createdAt,
        ageMinutes: Math.round((Date.now() - new Date(b.createdAt).getTime()) / (1000 * 60))
      }))
    });
    
  } catch (error) {
    logger.error('[Admin] Get pending bets error', error);
    return NextResponse.json(
      { error: 'Failed to get pending bets' },
      { status: 500 }
    );
  }
}

