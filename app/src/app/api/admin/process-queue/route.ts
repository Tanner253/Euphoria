/**
 * POST /api/admin/process-queue
 * Process pending withdrawals from the queue
 * 
 * SECURITY: Should be called via cron job or admin action only
 * In production, add authentication for admin endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { Keypair, Connection, Transaction, SystemProgram, sendAndConfirmTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import logger from '@/lib/utils/secureLogger';
import { TransactionService } from '@/lib/db/services';
import * as WithdrawalQueue from '@/lib/db/models/WithdrawalQueue';

// Only allow in development, with admin key, or from Vercel Cron
function isAuthorized(request: NextRequest): boolean {
  // In development, always allow
  if (process.env.NODE_ENV === 'development') {
    return true;
  }
  
  // Allow Vercel Cron requests (they include this header)
  const cronSecret = request.headers.get('authorization');
  if (cronSecret === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }
  
  // In production, require admin key
  const adminKey = request.headers.get('x-admin-key');
  return adminKey === process.env.ADMIN_API_KEY;
}

function getCustodialKeypair(): Keypair | null {
  const privateKey = process.env.CUSTODIAL_WALLET_PRIVATE_KEY;
  if (!privateKey) return null;
  
  try {
    const decoded = bs58.decode(privateKey);
    return Keypair.fromSecretKey(decoded);
  } catch {
    return null;
  }
}

async function getCustodialBalance(keypair: Keypair): Promise<number> {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  return connection.getBalance(keypair.publicKey);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const custodialKeypair = getCustodialKeypair();
  
  if (!custodialKeypair) {
    return NextResponse.json({ 
      error: 'Custodial wallet not configured',
      processed: 0,
      failed: 0 
    }, { status: 503 });
  }
  
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Get pending queue
    const pending = await WithdrawalQueue.getPendingQueue(10);
    
    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending withdrawals',
        processed: 0,
        failed: 0
      });
    }
    
    logger.info('[Queue] Processing withdrawals', { count: pending.length });
    
    let processed = 0;
    let failed = 0;
    const results: Array<{ withdrawalId: string; status: string; txSignature?: string; error?: string }> = [];
    
    // SECURITY: First reset any stuck withdrawals and clean up stale locks
    const stuckReset = await WithdrawalQueue.resetStuckWithdrawals();
    if (stuckReset > 0) {
      logger.info('[Queue] Reset stuck withdrawals', { count: stuckReset });
    }
    
    const staleLocksCleaned = await WithdrawalQueue.cleanupStaleLocks();
    if (staleLocksCleaned > 0) {
      logger.info('[Queue] Cleaned stale locks', { count: staleLocksCleaned });
    }
    
    for (const withdrawal of pending) {
      // SECURITY: Check if already completed (prevents replay)
      if (await WithdrawalQueue.isAlreadyCompleted(withdrawal.withdrawalId)) {
        logger.warn('[Queue] Skipping already completed withdrawal', {
          withdrawalId: withdrawal.withdrawalId
        });
        continue;
      }
      
      // Check balance for each withdrawal
      const balance = await getCustodialBalance(custodialKeypair);
      const lamportsNeeded = withdrawal.solAmount + 5000; // + tx fee buffer
      
      if (balance < lamportsNeeded) {
        logger.info('[Queue] Insufficient balance, stopping', {
          balance: balance / 1e9,
          needed: lamportsNeeded / 1e9
        });
        break; // Stop processing - not enough funds
      }
      
      // SECURITY: Atomically claim the withdrawal with a lock
      const claim = await WithdrawalQueue.claimForProcessing(withdrawal.withdrawalId);
      
      if (!claim) {
        logger.warn('[Queue] Failed to claim withdrawal (already processing or max retries)', {
          withdrawalId: withdrawal.withdrawalId
        });
        continue; // Another process claimed it, or max retries exceeded
      }
      
      const { lockId } = claim;
      
      try {
        const destinationPubkey = new PublicKey(withdrawal.walletAddress);
        
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: custodialKeypair.publicKey,
            toPubkey: destinationPubkey,
            lamports: withdrawal.solAmount,
          })
        );
        
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [custodialKeypair]
        );
        
        // SECURITY: Verify tx signature hasn't been used before
        if (await WithdrawalQueue.txSignatureExists(signature)) {
          logger.error('[Queue] SECURITY: Duplicate tx signature detected!', {
            signature: signature.slice(0, 16),
            withdrawalId: withdrawal.withdrawalId
          });
          await WithdrawalQueue.releaseLock(withdrawal.withdrawalId, lockId);
          continue;
        }
        
        // SECURITY: Mark completed with lock verification
        const completed = await WithdrawalQueue.markCompleted(
          withdrawal.withdrawalId, 
          signature,
          lockId
        );
        
        if (!completed) {
          logger.error('[Queue] Failed to mark completed - lock lost', {
            withdrawalId: withdrawal.withdrawalId
          });
          continue;
        }
        
        // Also update the transaction record status
        try {
          const transactionService = TransactionService.getInstance();
          await transactionService.confirmWithdrawalByWallet(
            withdrawal.walletAddress,
            signature
          );
        } catch (syncError) {
          logger.warn('[Queue] Failed to sync transaction status', {
            withdrawalId: withdrawal.withdrawalId,
            error: syncError instanceof Error ? syncError.message : 'Unknown'
          });
        }
        
        logger.info('[Queue] Processed', {
          wallet: withdrawal.walletAddress.slice(0, 8),
          sol: withdrawal.solAmount / 1e9,
          tx: signature.slice(0, 16)
        });
        
        processed++;
        results.push({
          withdrawalId: withdrawal.withdrawalId,
          status: 'completed',
          txSignature: signature
        });
        
      } catch (txError) {
        // SECURITY: Mark as failed with lock verification
        await WithdrawalQueue.markFailed(
          withdrawal.withdrawalId,
          txError instanceof Error ? txError.message : 'Transaction failed',
          lockId
        );
        
        logger.error('[Queue] Failed', {
          wallet: withdrawal.walletAddress.slice(0, 8),
          error: txError instanceof Error ? txError.message : 'Unknown error'
        });
        
        failed++;
        results.push({
          withdrawalId: withdrawal.withdrawalId,
          status: 'failed',
          error: txError instanceof Error ? txError.message : 'Transaction failed'
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      processed,
      failed,
      results
    });
    
  } catch (error) {
    logger.error('[API] Process queue error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/process-queue
 * Sync completed queue items with transactions collection
 */
export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    // Get all completed withdrawals from queue
    const allItems = await WithdrawalQueue.getAllQueueItems(100);
    const completedItems = allItems.filter(w => w.status === 'completed' && w.txSignature);
    
    let synced = 0;
    const transactionService = TransactionService.getInstance();
    
    for (const item of completedItems) {
      try {
        const result = await transactionService.confirmWithdrawalByWallet(
          item.walletAddress,
          item.txSignature!
        );
        if (result) {
          synced++;
          logger.info('[Queue] Synced transaction', {
            wallet: item.walletAddress.slice(0, 8),
            tx: item.txSignature?.slice(0, 16)
          });
        }
      } catch {
        // Already synced or doesn't exist
      }
    }
    
    return NextResponse.json({
      success: true,
      synced,
      totalCompleted: completedItems.length
    });
    
  } catch (error) {
    logger.error('[API] Sync queue error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/process-queue
 * Get queue statistics
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const queueStats = await WithdrawalQueue.getQueueStats();
    
    // Get custodial balance
    let custodialBalance = 0;
    const custodialKeypair = getCustodialKeypair();
    if (custodialKeypair) {
      custodialBalance = await getCustodialBalance(custodialKeypair);
    }
    
    // Get ALL withdrawals in queue (all statuses)
    const allItems = await WithdrawalQueue.getAllQueueItems(50);
    
    return NextResponse.json({
      ...queueStats,
      custodialBalanceLamports: custodialBalance,
      custodialBalanceSol: custodialBalance / 1e9,
      canProcessAll: custodialBalance >= queueStats.totalPendingSol,
      allWithdrawals: allItems.map(w => ({
        withdrawalId: w.withdrawalId,
        walletAddress: w.walletAddress.slice(0, 8) + '...',
        solAmount: w.solAmount / 1e9,
        status: w.status,
        queuePosition: w.queuePosition,
        requestedAt: w.requestedAt,
        attemptCount: w.attemptCount,
        failureReason: w.failureReason,
        txSignature: w.txSignature
      }))
    });
    
  } catch (error) {
    logger.error('[API] Get queue stats error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

