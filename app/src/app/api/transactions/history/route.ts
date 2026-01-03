/**
 * GET /api/transactions/history
 * Get user's transaction history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedWallet } from '@/lib/auth/jwt';
import { TransactionService, BetService } from '@/lib/db/services';
import logger from '@/lib/utils/secureLogger';

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
    const type = searchParams.get('type'); // 'transactions', 'bets', or 'all'
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 100);
    const skip = Number(searchParams.get('skip')) || 0;
    
    const response: Record<string, unknown> = {};
    
    // Get transactions (deposits/withdrawals)
    if (!type || type === 'all' || type === 'transactions') {
      const transactions = await TransactionService.getInstance().getUserTransactions(
        walletAddress,
        { limit, skip }
      );
      
      response.transactions = transactions.map(t => ({
        id: t._id?.toString(),
        type: t.type,
        status: t.status,
        solAmount: t.solAmount,
        gemsAmount: t.gemsAmount,
        feeAmount: t.feeAmount,
        txSignature: t.txSignature,
        createdAt: t.createdAt,
        confirmedAt: t.confirmedAt,
      }));
    }
    
    // Get bets
    if (!type || type === 'all' || type === 'bets') {
      const bets = await BetService.getInstance().getUserBets(
        walletAddress,
        { limit, skip }
      );
      
      response.bets = bets.map(b => ({
        id: b._id?.toString(),
        amount: b.amount,
        multiplier: b.multiplier,
        potentialWin: b.potentialWin,
        actualWin: b.actualWin,
        status: b.status,
        priceAtBet: b.priceAtBet,
        priceAtResolution: b.priceAtResolution,
        createdAt: b.createdAt,
        resolvedAt: b.resolvedAt,
      }));
    }
    
    // Get stats
    const bettingStats = await BetService.getInstance().getBettingStats(walletAddress);
    response.stats = bettingStats;
    
    return NextResponse.json(response);
    
  } catch (error) {
    logger.error('[API] Get history error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

