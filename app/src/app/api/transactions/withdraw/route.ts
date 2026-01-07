/**
 * POST /api/transactions/withdraw
 * Request a withdrawal (gems -> SOL to user's wallet)
 * 
 * SECURITY: Server-authoritative, all validations happen here
 * 
 * QUEUE SYSTEM: If custodial wallet has insufficient funds,
 * withdrawal is queued and processed when funds are available
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedWallet } from '@/lib/auth/jwt';
import { TransactionService, UserService } from '@/lib/db/services';
import logger from '@/lib/utils/secureLogger';
import * as WithdrawalQueue from '@/lib/db/models/WithdrawalQueue';

// In-flight request tracking to prevent race conditions
const processingWithdrawals = new Map<string, Promise<NextResponse>>();

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
    
    const body = await request.json();
    const { gemsAmount } = body;
    
    if (!gemsAmount || typeof gemsAmount !== 'number' || gemsAmount <= 0) {
      return NextResponse.json(
        { error: 'Invalid gems amount' },
        { status: 400 }
      );
    }
    
    // RACE CONDITION FIX: Check if this wallet already has an in-flight request
    const existingRequest = processingWithdrawals.get(walletAddress);
    if (existingRequest) {
      logger.info('[Withdrawal] Duplicate request detected, returning existing promise', {
        wallet: walletAddress.slice(0, 8)
      });
      return existingRequest;
    }
    
    // Create and store the processing promise
    const processPromise = processWithdrawal(walletAddress, gemsAmount);
    processingWithdrawals.set(walletAddress, processPromise);
    
    try {
      const result = await processPromise;
      return result;
    } finally {
      // Clean up after processing (with delay to catch rapid duplicates)
      setTimeout(() => processingWithdrawals.delete(walletAddress), 5000);
    }
    
  } catch (error) {
    logger.error('[API] Withdrawal error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function processWithdrawal(walletAddress: string, gemsAmount: number): Promise<NextResponse> {
  try {
    // SECURITY: Check for existing pending withdrawal in BOTH collections
    // This prevents race conditions where one collection has pending but not the other
    const hasPendingInQueue = await WithdrawalQueue.hasPendingWithdrawal(walletAddress);
    if (hasPendingInQueue) {
      logger.info('[Withdrawal] Blocked - pending in queue', {
        wallet: walletAddress.slice(0, 8)
      });
      return NextResponse.json(
        { error: 'You already have a pending withdrawal' },
        { status: 400 }
      );
    }
    
    // Create withdrawal request using TransactionService (includes all security checks)
    // This also checks for pending withdrawals in transactions collection
    const transactionService = TransactionService.getInstance();
    const result = await transactionService.createWithdrawal(
      walletAddress,
      gemsAmount,
      walletAddress // Destination must match authenticated wallet
    );
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }
    
    const lamports = result.solAmount!;
    
    // ALL withdrawals now require admin approval - queue with 'awaiting_approval' status
    const queueItem = await WithdrawalQueue.createWithdrawalRequest({
      walletAddress,
      gemsAmount,
      feeAmount: result.feeAmount || 0,
      netGems: result.netGems || gemsAmount,
      solAmount: lamports,
    });
    
    logger.info('[Withdrawal] Awaiting admin approval', {
      wallet: walletAddress.slice(0, 8),
      withdrawalId: queueItem.withdrawalId,
      sol: lamports / 1e9
    });
    
    return NextResponse.json({
      success: true,
      status: 'awaiting_approval',
      withdrawalId: queueItem.withdrawalId,
      queuePosition: queueItem.queuePosition,
      transaction: {
        id: result.transaction!._id?.toString(),
        gemsAmount,
        solAmount: lamports / 1e9,
        status: 'awaiting_approval'
      },
      message: `Withdrawal request submitted. Awaiting admin approval. You'll receive ${(lamports / 1e9).toFixed(4)} SOL once approved and processed.`
    });
    
  } catch (error) {
    logger.error('[API] Withdrawal processing error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/transactions/withdraw
 * Get withdrawal info (fee, minimums, pending withdrawal status)
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
    
    const userService = UserService.getInstance();
    const transactionService = TransactionService.getInstance();
    
    const user = await userService.getUser(walletAddress);
    
    // Check if user can withdraw
    const transactions = await transactionService.getUserTransactions(walletAddress);
    const hasDeposited = transactions.some(
      tx => tx.type === 'deposit' && tx.status === 'confirmed'
    );
    
    // Check for pending withdrawal
    const pendingWithdrawal = await WithdrawalQueue.getUserPendingWithdrawal(walletAddress);
    
    // Get daily withdrawal limits
    const dailyStats = await transactionService.getDailyWithdrawalTotal(walletAddress);
    const rateCheck = await transactionService.canWithdrawNow(walletAddress);
    
    return NextResponse.json({
      gemsBalance: user?.gemsBalance || 0,
      minWithdrawal: Number(process.env.MIN_WITHDRAWAL_GEMS) || 100,
      feePercent: (Number(process.env.WITHDRAWAL_FEE_PERCENT) || 0.02) * 100,
      gemsPerSol: Number(process.env.GEMS_PER_SOL) || 1000,
      canWithdraw: hasDeposited && (user?.gemsBalance || 0) >= (Number(process.env.MIN_WITHDRAWAL_GEMS) || 100) && rateCheck.canWithdraw,
      requiresDeposit: !hasDeposited,
      // Daily withdrawal limits
      limits: {
        dailyLimitSol: rateCheck.dailyLimit,
        dailyUsedSol: dailyStats.totalSol,
        dailyRemainingSol: dailyStats.remainingSol,
        maxSingleSol: rateCheck.maxSingle,
        withdrawalsToday: dailyStats.count,
        cooldownRemaining: rateCheck.cooldownRemaining
      },
      pendingWithdrawal: pendingWithdrawal ? {
        withdrawalId: pendingWithdrawal.withdrawalId,
        gemsAmount: pendingWithdrawal.gemsAmount,
        solAmount: pendingWithdrawal.solAmount / 1e9,
        queuePosition: pendingWithdrawal.queuePosition,
        status: pendingWithdrawal.status,
        requestedAt: pendingWithdrawal.requestedAt,
        canCancel: pendingWithdrawal.status === 'awaiting_approval' || pendingWithdrawal.status === 'pending'
      } : null
    });
    
  } catch (error) {
    logger.error('[API] Get withdrawal info error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
