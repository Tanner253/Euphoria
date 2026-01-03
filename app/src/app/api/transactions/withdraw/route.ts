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
import { Keypair, Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import logger from '@/lib/utils/secureLogger';
import * as WithdrawalQueue from '@/lib/db/models/WithdrawalQueue';

// SECURITY: Never log the private key - only check if it's configured
function getCustodialKeypair(): Keypair | null {
  const privateKey = process.env.CUSTODIAL_WALLET_PRIVATE_KEY;
  
  // SECURITY: Never log the private key or any information about it
  if (!privateKey) {
    logger.error('[Withdrawal] Custodial wallet not configured');
    return null;
  }
  
  try {
    const decoded = bs58.decode(privateKey);
    return Keypair.fromSecretKey(decoded);
  } catch {
    // SECURITY: Generic error - do not expose any details about the key
    logger.error('[Withdrawal] Custodial wallet configuration error');
    return null;
  }
}

/**
 * Check if custodial wallet has enough balance for immediate payout
 */
async function canProcessImmediately(lamportsNeeded: number): Promise<boolean> {
  const keypair = getCustodialKeypair();
  if (!keypair) return false;
  
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    const balance = await connection.getBalance(keypair.publicKey);
    
    // Need lamports + buffer for tx fee (5000 lamports ~= 0.000005 SOL)
    const totalNeeded = lamportsNeeded + 5000;
    
    logger.info('[Withdrawal] Balance check', {
      balance: balance / 1e9,
      needed: totalNeeded / 1e9,
      canAfford: balance >= totalNeeded
    });
    
    return balance >= totalNeeded;
  } catch (error) {
    logger.error('[Withdrawal] Balance check failed', error);
    return false;
  }
}

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
    
    // SECURITY: Check for existing pending withdrawal
    const hasPending = await WithdrawalQueue.hasPendingWithdrawal(walletAddress);
    if (hasPending) {
      return NextResponse.json(
        { error: 'You already have a pending withdrawal' },
        { status: 400 }
      );
    }
    
    // Create withdrawal request using TransactionService (includes all security checks)
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
    
    // Check if we can process immediately
    const canProcessNow = await canProcessImmediately(lamports);
    
    if (canProcessNow) {
      // Try immediate payout
      const custodialKeypair = getCustodialKeypair();
      
      if (custodialKeypair) {
        try {
          const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
          const connection = new Connection(rpcUrl, 'confirmed');
          
          const destinationPubkey = new PublicKey(walletAddress);
          
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: custodialKeypair.publicKey,
              toPubkey: destinationPubkey,
              lamports,
            })
          );
          
          const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [custodialKeypair]
          );
          
          // Confirm in database
          await transactionService.confirmWithdrawal(
            result.transaction!._id!.toString(),
            signature
          );
          
          logger.info('[Withdrawal] Instant success', { 
            wallet: walletAddress.slice(0, 8),
            sol: lamports / 1e9
          });
          
          return NextResponse.json({
            success: true,
            status: 'completed',
            transaction: {
              id: result.transaction!._id?.toString(),
              gemsAmount,
              solAmount: lamports / 1e9,
              txSignature: signature,
              status: 'confirmed'
            }
          });
          
        } catch (txError) {
          // Transaction failed - fall through to queue
          logger.warn('[Withdrawal] Instant payout failed, queueing', {
            wallet: walletAddress.slice(0, 8)
          });
        }
      }
    }
    
    // Queue the withdrawal (either no funds or transaction failed)
    const queueItem = await WithdrawalQueue.createWithdrawalRequest({
      walletAddress,
      gemsAmount,
      feeAmount: result.feeAmount || 0,
      netGems: result.netGems || gemsAmount,
      solAmount: lamports,
    });
    
    logger.info('[Withdrawal] Queued', {
      wallet: walletAddress.slice(0, 8),
      position: queueItem.queuePosition,
      sol: lamports / 1e9
    });
    
    return NextResponse.json({
      success: true,
      status: 'queued',
      withdrawalId: queueItem.withdrawalId,
      queuePosition: queueItem.queuePosition,
      transaction: {
        id: result.transaction!._id?.toString(),
        gemsAmount,
        solAmount: lamports / 1e9,
        status: 'queued'
      },
      message: `Withdrawal queued at position #${queueItem.queuePosition}. You'll receive ${(lamports / 1e9).toFixed(4)} SOL when funds are available.`
    });
    
  } catch (error) {
    logger.error('[API] Withdrawal error', error);
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
    
    return NextResponse.json({
      gemsBalance: user?.gemsBalance || 0,
      minWithdrawal: Number(process.env.MIN_WITHDRAWAL_GEMS) || 100,
      feePercent: (Number(process.env.WITHDRAWAL_FEE_PERCENT) || 0.02) * 100,
      gemsPerSol: Number(process.env.GEMS_PER_SOL) || 1000,
      canWithdraw: hasDeposited && (user?.gemsBalance || 0) >= (Number(process.env.MIN_WITHDRAWAL_GEMS) || 100),
      requiresDeposit: !hasDeposited,
      pendingWithdrawal: pendingWithdrawal ? {
        withdrawalId: pendingWithdrawal.withdrawalId,
        gemsAmount: pendingWithdrawal.gemsAmount,
        solAmount: pendingWithdrawal.solAmount / 1e9,
        queuePosition: pendingWithdrawal.queuePosition,
        status: pendingWithdrawal.status,
        requestedAt: pendingWithdrawal.requestedAt,
        canCancel: pendingWithdrawal.status === 'pending'
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
