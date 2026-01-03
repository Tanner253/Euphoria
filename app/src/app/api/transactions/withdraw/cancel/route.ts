/**
 * POST /api/transactions/withdraw/cancel
 * Cancel a pending withdrawal and refund gems
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedWallet } from '@/lib/auth/jwt';
import { TransactionService, UserService } from '@/lib/db/services';
import * as WithdrawalQueue from '@/lib/db/models/WithdrawalQueue';
import logger from '@/lib/utils/secureLogger';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const walletAddress = getAuthenticatedWallet(authHeader);
    
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Get user's pending withdrawal from queue
    const pendingWithdrawal = await WithdrawalQueue.getUserPendingWithdrawal(walletAddress);
    
    if (!pendingWithdrawal) {
      return NextResponse.json(
        { error: 'No pending withdrawal to cancel' },
        { status: 400 }
      );
    }
    
    // Only allow cancellation if status is 'pending' (not 'processing')
    if (pendingWithdrawal.status !== 'pending') {
      return NextResponse.json(
        { error: 'Cannot cancel - withdrawal is already being processed' },
        { status: 400 }
      );
    }
    
    // Cancel in queue
    const cancelled = await WithdrawalQueue.cancelWithdrawal(
      pendingWithdrawal.withdrawalId,
      walletAddress
    );
    
    if (!cancelled) {
      return NextResponse.json(
        { error: 'Failed to cancel withdrawal' },
        { status: 500 }
      );
    }
    
    // Refund gems to user
    const userService = UserService.getInstance();
    await userService.updateBalance(
      walletAddress,
      pendingWithdrawal.gemsAmount,
      `Withdrawal cancelled - refunded ${pendingWithdrawal.gemsAmount} gems`
    );
    
    // Also cancel in transactions collection
    const transactionService = TransactionService.getInstance();
    await transactionService.cancelPendingWithdrawalByWallet(walletAddress);
    
    logger.info('[Withdrawal] Cancelled', {
      wallet: walletAddress.slice(0, 8),
      gemsRefunded: pendingWithdrawal.gemsAmount
    });
    
    return NextResponse.json({
      success: true,
      gemsRefunded: pendingWithdrawal.gemsAmount,
      message: `Withdrawal cancelled. ${pendingWithdrawal.gemsAmount} gems refunded.`
    });
    
  } catch (error) {
    logger.error('[API] Cancel withdrawal error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

