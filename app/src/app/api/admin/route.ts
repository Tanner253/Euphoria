/**
 * GET /api/admin
 * Admin dashboard data - DEVELOPMENT ONLY
 * 
 * Returns comprehensive live data from database for monitoring
 * 
 * POST /api/admin
 * Admin actions (cleanup, etc.) - DEVELOPMENT ONLY
 */

import { NextRequest, NextResponse } from 'next/server';
import { TransactionService, UserService, BetService, AuditService } from '@/lib/db/services';
import { connectToDatabase } from '@/lib/db/mongodb';
import * as WithdrawalQueue from '@/lib/db/models/WithdrawalQueue';
import { Keypair, Connection, Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import logger from '@/lib/utils/secureLogger';

// SECURITY: Only available in development mode
function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

// Helper: Get custodial wallet keypair
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

// Helper: Confirm transaction via HTTP polling (avoids WebSocket issues in serverless)
async function confirmTransactionPolling(
  connection: Connection,
  signature: string,
  maxAttempts: number = 30,
  delayMs: number = 1000
): Promise<{ confirmed: boolean; error?: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const status = await connection.getSignatureStatus(signature);
      
      if (status?.value?.err) {
        return { confirmed: false, error: `Transaction failed: ${JSON.stringify(status.value.err)}` };
      }
      
      if (status?.value?.confirmationStatus === 'confirmed' || 
          status?.value?.confirmationStatus === 'finalized') {
        return { confirmed: true };
      }
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } catch (error) {
      logger.warn('[Admin] Polling attempt failed', { attempt, error });
    }
  }
  
  return { confirmed: false, error: 'Confirmation timeout' };
}

export async function GET(request: NextRequest) {
  // SECURITY: Block in production
  if (!isDevelopment()) {
    return NextResponse.json(
      { error: 'Not available in production' },
      { status: 403 }
    );
  }
  
  // Check if database is configured
  if (!process.env.MONGODB_URI) {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      error: 'Database not configured - set MONGODB_URI in .env.local',
      stats: null,
      transactions: [],
      users: [],
      bets: [],
      alerts: [],
      hourlyStats: [],
      dailyStats: [],
    });
  }
  
  // Test database connection first
  try {
    await connectToDatabase();
  } catch (dbError) {
    const dbMessage = dbError instanceof Error ? dbError.message : 'Connection failed';
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      error: `Database connection error: ${dbMessage}`,
      stats: null,
      transactions: [],
      users: [],
      bets: [],
      alerts: [],
      hourlyStats: [],
      dailyStats: [],
    });
  }
  
  try {
    const { searchParams } = new URL(request.url);
    const txLimit = Math.min(Number(searchParams.get('txLimit')) || 50, 200);
    const userLimit = Math.min(Number(searchParams.get('userLimit')) || 50, 200);
    const betLimit = Math.min(Number(searchParams.get('betLimit')) || 50, 200);
    
    const transactionService = TransactionService.getInstance();
    const userService = UserService.getInstance();
    const betService = BetService.getInstance();
    const auditService = AuditService.getInstance();
    
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Fetch all data in parallel
    const [
      usersSummary,
      transactionStats,
      bettingStats,
      allTransactions,
      allUsers,
      allBets,
      recentAudit,
      hourlyTransactions,
      dailyTransactions,
      hourlyBets,
      dailyBets,
      awaitingApprovalWithdrawals,
    ] = await Promise.all([
      userService.getUsersSummary(),
      transactionService.getTransactionStats(),
      betService.getBettingStats(),
      transactionService.getAllTransactions({ limit: txLimit }),
      userService.getAllUsers({ limit: userLimit, sortBy: 'lastActiveAt', sortOrder: 'desc' }),
      betService.getAllBets({ limit: betLimit }),
      auditService.getLogsByTimeRange(oneDayAgo, now, { limit: 100 }),
      transactionService.getAllTransactions({ limit: 10000, startDate: oneHourAgo, endDate: now }),
      transactionService.getAllTransactions({ limit: 10000, startDate: oneDayAgo, endDate: now }),
      betService.getAllBets({ limit: 10000, startDate: oneHourAgo, endDate: now }),
      betService.getAllBets({ limit: 10000, startDate: oneDayAgo, endDate: now }),
      WithdrawalQueue.getAwaitingApproval(50),
    ]);
    
    // Calculate hourly stats
    const hourlyDeposits = hourlyTransactions.filter(tx => tx.type === 'deposit' && tx.status === 'confirmed');
    const hourlyWithdrawals = hourlyTransactions.filter(tx => tx.type === 'withdrawal' && tx.status === 'confirmed');
    const hourlyDepositSol = hourlyDeposits.reduce((sum, tx) => sum + tx.solAmount, 0) / 1e9;
    const hourlyWithdrawalSol = hourlyWithdrawals.reduce((sum, tx) => sum + tx.solAmount, 0) / 1e9;
    const hourlyWins = hourlyBets.filter(bet => bet.status === 'won');
    const hourlyLosses = hourlyBets.filter(bet => bet.status === 'lost');
    const hourlyGemsWon = hourlyWins.reduce((sum, bet) => sum + (bet.actualWin || 0), 0);
    const hourlyGemsLost = hourlyLosses.reduce((sum, bet) => sum + bet.amount, 0);
    
    // Calculate daily stats
    const dailyDeposits = dailyTransactions.filter(tx => tx.type === 'deposit' && tx.status === 'confirmed');
    const dailyWithdrawals = dailyTransactions.filter(tx => tx.type === 'withdrawal' && tx.status === 'confirmed');
    const dailyDepositSol = dailyDeposits.reduce((sum, tx) => sum + tx.solAmount, 0) / 1e9;
    const dailyWithdrawalSol = dailyWithdrawals.reduce((sum, tx) => sum + tx.solAmount, 0) / 1e9;
    const dailyWins = dailyBets.filter(bet => bet.status === 'won');
    const dailyLosses = dailyBets.filter(bet => bet.status === 'lost');
    const dailyGemsWon = dailyWins.reduce((sum, bet) => sum + (bet.actualWin || 0), 0);
    const dailyGemsLost = dailyLosses.reduce((sum, bet) => sum + bet.amount, 0);
    
    // Generate alerts
    const alerts: Array<{ type: 'error' | 'warning' | 'info'; message: string; timestamp: string; details?: unknown }> = [];
    
    // Check for failed/cancelled transactions
    const failedTransactions = allTransactions.filter(tx => tx.status === 'failed' || tx.status === 'cancelled');
    failedTransactions.forEach(tx => {
      alerts.push({
        type: 'error',
        message: `${tx.type.toUpperCase()} ${tx.status}: ${tx.walletAddress.slice(0, 8)}... - ${tx.solAmount / 1e9} SOL`,
        timestamp: tx.createdAt.toISOString(),
        details: { id: tx._id?.toString(), notes: tx.notes }
      });
    });
    
    // Check for pending withdrawals (potential issues)
    const pendingWithdrawals = allTransactions.filter(tx => tx.type === 'withdrawal' && tx.status === 'pending');
    const oldPendingWithdrawals = pendingWithdrawals.filter(tx => 
      new Date(tx.createdAt).getTime() < now.getTime() - 30 * 60 * 1000 // Older than 30 min
    );
    oldPendingWithdrawals.forEach(tx => {
      alerts.push({
        type: 'warning',
        message: `Withdrawal pending > 30min: ${tx.walletAddress.slice(0, 8)}... - ${tx.solAmount / 1e9} SOL`,
        timestamp: tx.createdAt.toISOString(),
        details: { id: tx._id?.toString() }
      });
    });
    
    // Check for expired bets
    const expiredBets = allBets.filter(bet => bet.status === 'expired');
    if (expiredBets.length > 0) {
      alerts.push({
        type: 'warning',
        message: `${expiredBets.length} expired bets detected`,
        timestamp: now.toISOString(),
      });
    }
    
    // Check solvency
    const totalDepositedSol = transactionStats.totalDepositSol / 1e9;
    const totalWithdrawnSol = transactionStats.totalWithdrawalSol / 1e9;
    const pendingWithdrawalSol = transactionStats.pendingWithdrawalSol / 1e9;
    const netCustodialBalance = totalDepositedSol - totalWithdrawnSol - pendingWithdrawalSol;
    
    if (netCustodialBalance < 0) {
      alerts.push({
        type: 'error',
        message: `CRITICAL: Negative custodial balance (${netCustodialBalance.toFixed(4)} SOL)`,
        timestamp: now.toISOString(),
      });
    } else if (pendingWithdrawalSol > netCustodialBalance * 0.8) {
      alerts.push({
        type: 'warning',
        message: `High pending withdrawal ratio: ${((pendingWithdrawalSol / netCustodialBalance) * 100).toFixed(1)}%`,
        timestamp: now.toISOString(),
      });
    }
    
    // Calculate house profit
    const houseProfit = bettingStats.totalWagered - bettingStats.totalPaidOut;
    const houseEdgePercent = bettingStats.totalWagered > 0 
      ? (houseProfit / bettingStats.totalWagered * 100) 
      : 0;
    
    // Sort alerts by timestamp (newest first)
    alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return NextResponse.json({
      timestamp: now.toISOString(),
      
      // Overview stats
      stats: {
        users: {
          total: usersSummary.totalUsers,
          active24h: usersSummary.activeUsers24h,
          gemsInCirculation: usersSummary.totalGemsInCirculation,
        },
        sol: {
          totalDeposited: totalDepositedSol,
          totalWithdrawn: totalWithdrawnSol,
          pendingWithdrawals: pendingWithdrawalSol,
          netCustodialBalance,
          houseProfit: totalDepositedSol - totalWithdrawnSol, // Deposits - Withdrawals = House Profit in SOL
        },
        transactions: {
          totalDeposits: transactionStats.totalDeposits,
          totalWithdrawals: transactionStats.totalWithdrawals,
          pendingWithdrawals: transactionStats.pendingWithdrawals,
          failedCount: failedTransactions.length,
        },
        betting: {
          totalBets: bettingStats.totalBets,
          totalWins: bettingStats.totalWins,
          totalLosses: bettingStats.totalLosses,
          totalWagered: bettingStats.totalWagered,
          totalPaidOut: bettingStats.totalPaidOut,
          houseProfit,
          houseEdgePercent: Number(houseEdgePercent.toFixed(2)),
        },
      },
      
      // Hourly breakdown
      hourly: {
        deposits: { count: hourlyDeposits.length, sol: hourlyDepositSol },
        withdrawals: { count: hourlyWithdrawals.length, sol: hourlyWithdrawalSol },
        netFlow: hourlyDepositSol - hourlyWithdrawalSol,
        bets: { total: hourlyBets.length, wins: hourlyWins.length, losses: hourlyLosses.length },
        gemsWon: hourlyGemsWon,
        gemsLost: hourlyGemsLost,
        houseProfit: hourlyGemsLost - hourlyGemsWon,
      },
      
      // Daily breakdown
      daily: {
        deposits: { count: dailyDeposits.length, sol: dailyDepositSol },
        withdrawals: { count: dailyWithdrawals.length, sol: dailyWithdrawalSol },
        netFlow: dailyDepositSol - dailyWithdrawalSol,
        bets: { total: dailyBets.length, wins: dailyWins.length, losses: dailyLosses.length },
        gemsWon: dailyGemsWon,
        gemsLost: dailyGemsLost,
        houseProfit: dailyGemsLost - dailyGemsWon,
      },
      
      // Alerts
      alerts,
      
      // Recent transactions
      transactions: allTransactions.map(tx => ({
        id: tx._id?.toString(),
        type: tx.type,
        status: tx.status,
        walletAddress: tx.walletAddress,
        solAmount: tx.solAmount / 1e9,
        gemsAmount: tx.gemsAmount,
        feeAmount: tx.feeAmount || 0,
        txSignature: tx.txSignature || null,
        createdAt: tx.createdAt,
        confirmedAt: tx.confirmedAt,
        notes: tx.notes,
      })),
      
      // Users
      users: allUsers.map(user => ({
        id: user._id?.toString(),
        walletAddress: user.walletAddress,
        gemsBalance: user.gemsBalance,
        totalDeposited: user.totalDeposited / 1e9,
        totalWithdrawn: user.totalWithdrawn / 1e9,
        totalBets: user.totalBets,
        totalWins: user.totalWins,
        totalLosses: user.totalLosses,
        winRate: user.totalBets > 0 ? Number((user.totalWins / user.totalBets * 100).toFixed(1)) : 0,
        netProfit: user.totalWon - user.totalLost,
        status: user.status,
        createdAt: user.createdAt,
        lastActiveAt: user.lastActiveAt,
      })),
      
      // Recent bets
      bets: allBets.map(bet => ({
        id: bet._id?.toString(),
        walletAddress: bet.walletAddress,
        amount: bet.amount,
        multiplier: bet.multiplier,
        potentialWin: bet.potentialWin,
        actualWin: bet.actualWin || 0,
        status: bet.status,
        priceAtBet: bet.priceAtBet,
        priceAtResolution: bet.priceAtResolution,
        createdAt: bet.createdAt,
        resolvedAt: bet.resolvedAt,
      })),
      
      // Recent audit log
      auditLog: recentAudit.map(log => ({
        id: log._id?.toString(),
        action: log.action,
        description: log.description,
        walletAddress: log.walletAddress || null,
        createdAt: log.createdAt,
      })),
      
      // Withdrawals awaiting admin approval
      pendingApprovals: awaitingApprovalWithdrawals.map(w => ({
        withdrawalId: w.withdrawalId,
        walletAddress: w.walletAddress,
        gemsAmount: w.gemsAmount,
        feeAmount: w.feeAmount,
        netGems: w.netGems,
        solAmount: w.solAmount / 1e9,
        queuePosition: w.queuePosition,
        requestedAt: w.requestedAt,
      })),
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Admin API] Error:', message);
    
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      error: `API Error: ${message}`,
      stats: null,
      transactions: [],
      users: [],
      bets: [],
      alerts: [{ type: 'error', message: `API Error: ${message}`, timestamp: new Date().toISOString() }],
      hourlyStats: [],
      dailyStats: [],
    });
  }
}

/**
 * POST /api/admin
 * Admin actions - DEVELOPMENT ONLY
 * 
 * Supported actions:
 * - cleanup_pending_deposits: Remove orphaned pending deposits (no txSignature)
 * - cleanup_pending_withdrawals: Cancel orphaned pending withdrawals
 */
export async function POST(request: NextRequest) {
  // SECURITY: Block in production
  if (!isDevelopment()) {
    return NextResponse.json(
      { error: 'Not available in production' },
      { status: 403 }
    );
  }
  
  try {
    const body = await request.json();
    const { action } = body;
    
    if (!action) {
      return NextResponse.json(
        { error: 'Missing action parameter' },
        { status: 400 }
      );
    }
    
    const { db } = await connectToDatabase();
    const transactionsCollection = db.collection('transactions');
    const auditService = AuditService.getInstance();
    
    switch (action) {
      case 'cleanup_pending_deposits': {
        // Mark orphaned pending deposits as cancelled (keeps audit trail)
        const result = await transactionsCollection.updateMany(
          {
            type: 'deposit',
            status: 'pending',
            $or: [
              { txSignature: { $exists: false } },
              { txSignature: null }
            ]
          },
          {
            $set: {
              status: 'cancelled',
              notes: 'Admin cancelled: orphaned deposit (no tx signature)',
              cancelledAt: new Date()
            }
          }
        );
        
        await auditService.log({
          action: 'admin_action',
          description: `Cancelled ${result.modifiedCount} orphaned pending deposits`,
        });
        
        return NextResponse.json({
          success: true,
          action: 'cleanup_pending_deposits',
          cancelledCount: result.modifiedCount,
          message: `Cancelled ${result.modifiedCount} orphaned pending deposits`
        });
      }
      
      case 'cleanup_pending_withdrawals': {
        // Find pending withdrawals without txSignature and refund them
        // Check for both missing field and null value
        const pendingWithdrawals = await transactionsCollection.find({
          type: 'withdrawal',
          status: 'pending',
          $or: [
            { txSignature: { $exists: false } },
            { txSignature: null }
          ]
        }).toArray();
        
        const userService = UserService.getInstance();
        let refundedCount = 0;
        let refundedGems = 0;
        
        for (const withdrawal of pendingWithdrawals) {
          // Refund the gems
          await userService.updateBalance(
            withdrawal.walletAddress,
            withdrawal.gemsAmount,
            `Admin cleanup: Refunded ${withdrawal.gemsAmount} gems from orphaned withdrawal`
          );
          refundedGems += withdrawal.gemsAmount;
          refundedCount++;
        }
        
        // Mark them as cancelled
        const result = await transactionsCollection.updateMany(
          {
            type: 'withdrawal',
            status: 'pending',
            $or: [
              { txSignature: { $exists: false } },
              { txSignature: null }
            ]
          },
          {
            $set: {
              status: 'cancelled',
              notes: 'Admin cleanup: orphaned withdrawal'
            }
          }
        );
        
        await auditService.log({
          action: 'admin_action',
          description: `Cancelled ${result.modifiedCount} orphaned pending withdrawals, refunded ${refundedGems} gems`,
        });
        
        return NextResponse.json({
          success: true,
          action: 'cleanup_pending_withdrawals',
          cancelledCount: result.modifiedCount,
          refundedCount,
          refundedGems,
          message: `Cancelled ${result.modifiedCount} orphaned withdrawals, refunded ${refundedGems} gems`
        });
      }
      
      case 'cleanup_all_pending': {
        // Clean up both deposits and withdrawals (mark as cancelled, don't delete)
        
        // 1. Cancel orphaned pending deposits (no txSignature)
        const depositResult = await transactionsCollection.updateMany(
          {
            type: 'deposit',
            status: 'pending',
            $or: [
              { txSignature: { $exists: false } },
              { txSignature: null }
            ]
          },
          {
            $set: {
              status: 'cancelled',
              notes: 'Admin cleanup: orphaned deposit (no tx signature)',
              cancelledAt: new Date()
            }
          }
        );
        
        // 2. Cancel and refund orphaned pending withdrawals (no txSignature)
        const pendingWithdrawals = await transactionsCollection.find({
          type: 'withdrawal',
          status: 'pending',
          $or: [
            { txSignature: { $exists: false } },
            { txSignature: null }
          ]
        }).toArray();
        
        const userService = UserService.getInstance();
        let refundedGems = 0;
        
        for (const withdrawal of pendingWithdrawals) {
          await userService.updateBalance(
            withdrawal.walletAddress,
            withdrawal.gemsAmount,
            `Admin cleanup: Refunded ${withdrawal.gemsAmount} gems from orphaned withdrawal`
          );
          refundedGems += withdrawal.gemsAmount;
        }
        
        const withdrawalResult = await transactionsCollection.updateMany(
          {
            type: 'withdrawal',
            status: 'pending',
            $or: [
              { txSignature: { $exists: false } },
              { txSignature: null }
            ]
          },
          {
            $set: {
              status: 'cancelled',
              notes: 'Admin cleanup: orphaned withdrawal',
              cancelledAt: new Date()
            }
          }
        );
        
        await auditService.log({
          action: 'admin_action',
          description: `Cleanup: Cancelled ${depositResult.modifiedCount} orphaned deposits, cancelled ${withdrawalResult.modifiedCount} withdrawals, refunded ${refundedGems} gems`,
        });
        
        return NextResponse.json({
          success: true,
          action: 'cleanup_all_pending',
          deposits: {
            cancelledCount: depositResult.modifiedCount
          },
          withdrawals: {
            cancelledCount: withdrawalResult.modifiedCount,
            refundedGems
          },
          message: `Cancelled ${depositResult.modifiedCount} orphaned deposits, cancelled ${withdrawalResult.modifiedCount} withdrawals, refunded ${refundedGems} gems`
        });
      }
      
      case 'delete_all_pending_deposits': {
        // Mark ALL pending deposits as cancelled (keeps audit trail)
        const result = await transactionsCollection.updateMany(
          {
            type: 'deposit',
            status: 'pending'
          },
          {
            $set: {
              status: 'cancelled',
              notes: 'Admin cancelled: pending deposit cleanup',
              cancelledAt: new Date()
            }
          }
        );
        
        await auditService.log({
          action: 'admin_action',
          description: `Cancelled ALL ${result.modifiedCount} pending deposits`,
        });
        
        return NextResponse.json({
          success: true,
          action: 'cancel_all_pending_deposits',
          cancelledCount: result.modifiedCount,
          message: `Cancelled ${result.modifiedCount} pending deposits`
        });
      }
      
      case 'update_user_status': {
        // Update a user's status (active, suspended, banned)
        const { walletAddress, status } = body;
        
        if (!walletAddress || !status) {
          return NextResponse.json(
            { error: 'Missing walletAddress or status' },
            { status: 400 }
          );
        }
        
        if (!['active', 'suspended', 'banned'].includes(status)) {
          return NextResponse.json(
            { error: 'Invalid status. Must be: active, suspended, or banned' },
            { status: 400 }
          );
        }
        
        const usersCollection = db.collection('users');
        const result = await usersCollection.updateOne(
          { walletAddress },
          { $set: { status, updatedAt: new Date() } }
        );
        
        if (result.matchedCount === 0) {
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }
        
        const auditAction = status === 'banned' ? 'user_banned' : status === 'suspended' ? 'user_suspended' : 'admin_action';
        await auditService.log({
          walletAddress,
          action: auditAction,
          description: `User status changed to: ${status}`,
        });
        
        return NextResponse.json({
          success: true,
          action: 'update_user_status',
          walletAddress: walletAddress.slice(0, 8) + '...',
          newStatus: status,
          message: `User status updated to ${status}`
        });
      }
      
      case 'process_queue': {
        try {
          // First clean up any stale locks
          const { cleanupStaleLocks, getPendingQueue } = await import('@/lib/db/models/WithdrawalQueue');
          await cleanupStaleLocks();
          
          const pendingQueue = await getPendingQueue(10);
          
          return NextResponse.json({
            success: true,
            action: 'process_queue',
            pendingCount: pendingQueue.length,
            message: `Queue has ${pendingQueue.length} pending withdrawals. Use /api/admin/process-queue endpoint for actual processing.`
          });
        } catch (err) {
          return NextResponse.json({
            success: false,
            action: 'process_queue',
            error: String(err),
            message: 'Failed to check withdrawal queue'
          });
        }
      }
      
      case 'approve_withdrawal': {
        // Admin approves a withdrawal request - IMMEDIATELY processes it (sends SOL)
        const { withdrawalId } = body;
        
        if (!withdrawalId) {
          return NextResponse.json(
            { error: 'Missing withdrawalId' },
            { status: 400 }
          );
        }
        
        // Get the withdrawal first
        const withdrawal = await WithdrawalQueue.getWithdrawal(withdrawalId);
        if (!withdrawal || withdrawal.status !== 'awaiting_approval') {
          return NextResponse.json(
            { error: 'Withdrawal not found or not awaiting approval' },
            { status: 404 }
          );
        }
        
        // Get custodial wallet
        const custodialKeypair = getCustodialKeypair();
        if (!custodialKeypair) {
          return NextResponse.json(
            { error: 'Custodial wallet not configured' },
            { status: 503 }
          );
        }
        
        // Check balance
        const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
        const connection = new Connection(rpcUrl, 'confirmed');
        const balance = await connection.getBalance(custodialKeypair.publicKey);
        const lamportsNeeded = withdrawal.solAmount + 5000; // + tx fee buffer
        
        if (balance < lamportsNeeded) {
          return NextResponse.json({
            success: false,
            error: `Insufficient custodial balance. Have: ${(balance / 1e9).toFixed(4)} SOL, Need: ${(lamportsNeeded / 1e9).toFixed(4)} SOL`,
          }, { status: 400 });
        }
        
        // Approve first (move to pending)
        const adminWallet = 'admin';
        const approved = await WithdrawalQueue.approveWithdrawal(withdrawalId, adminWallet);
        
        if (!approved) {
          return NextResponse.json(
            { error: 'Failed to approve withdrawal' },
            { status: 500 }
          );
        }
        
        // Now claim for processing
        const claim = await WithdrawalQueue.claimForProcessing(withdrawalId);
        if (!claim) {
          return NextResponse.json(
            { error: 'Failed to claim withdrawal for processing' },
            { status: 500 }
          );
        }
        
        const { lockId } = claim;
        
        try {
          const destinationPubkey = new PublicKey(withdrawal.walletAddress);
          
          // Get recent blockhash
          const { blockhash } = await connection.getLatestBlockhash('confirmed');
          
          const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: custodialKeypair.publicKey,
          }).add(
            SystemProgram.transfer({
              fromPubkey: custodialKeypair.publicKey,
              toPubkey: destinationPubkey,
              lamports: withdrawal.solAmount,
            })
          );
          
          // Sign and send
          transaction.sign(custodialKeypair);
          const signature = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          });
          
          // Confirm using HTTP polling
          const confirmation = await confirmTransactionPolling(connection, signature);
          
          if (!confirmation.confirmed) {
            logger.warn('[Admin] Confirmation timeout, marking completed anyway', {
              withdrawalId,
              signature: signature.slice(0, 16)
            });
          }
          
          // Mark as completed
          const completed = await WithdrawalQueue.markCompleted(withdrawalId, signature, lockId);
          
          if (!completed) {
            logger.error('[Admin] Failed to mark completed - lock lost', { withdrawalId });
          }
          
          // Also update the transaction record status
          try {
            const transactionService = TransactionService.getInstance();
            await transactionService.confirmWithdrawalByWallet(
              withdrawal.walletAddress,
              signature
            );
          } catch (syncError) {
            logger.warn('[Admin] Failed to sync transaction status', {
              withdrawalId,
              error: syncError instanceof Error ? syncError.message : 'Unknown'
            });
          }
          
          await auditService.log({
            walletAddress: withdrawal.walletAddress,
            action: 'withdrawal_approved',
            description: `Admin approved and processed withdrawal ${withdrawalId} for ${withdrawal.solAmount / 1e9} SOL. TX: ${signature.slice(0, 16)}...`,
          });
          
          logger.info('[Admin] Withdrawal approved and processed', {
            wallet: withdrawal.walletAddress.slice(0, 8),
            sol: withdrawal.solAmount / 1e9,
            tx: signature.slice(0, 16)
          });
          
          return NextResponse.json({
            success: true,
            action: 'approve_withdrawal',
            withdrawalId,
            walletAddress: withdrawal.walletAddress.slice(0, 8) + '...',
            solAmount: withdrawal.solAmount / 1e9,
            txSignature: signature,
            message: `Withdrawal approved and sent! TX: ${signature.slice(0, 16)}...`
          });
          
        } catch (txError) {
          // Transaction failed - mark as failed and release lock
          await WithdrawalQueue.markFailed(
            withdrawalId,
            txError instanceof Error ? txError.message : 'Transaction failed',
            lockId
          );
          
          logger.error('[Admin] Withdrawal processing failed', {
            withdrawalId,
            error: txError instanceof Error ? txError.message : 'Unknown error'
          });
          
          return NextResponse.json({
            success: false,
            error: `Transaction failed: ${txError instanceof Error ? txError.message : 'Unknown error'}`,
            withdrawalId,
          }, { status: 500 });
        }
      }
      
      case 'reject_withdrawal': {
        // Admin rejects a withdrawal request - refunds gems to user
        const { withdrawalId, reason } = body;
        
        if (!withdrawalId) {
          return NextResponse.json(
            { error: 'Missing withdrawalId' },
            { status: 400 }
          );
        }
        
        const rejectionReason = reason || 'Rejected by admin';
        const adminWallet = 'admin';
        
        // Get the withdrawal first to know how much to refund
        const withdrawal = await WithdrawalQueue.getWithdrawal(withdrawalId);
        if (!withdrawal || withdrawal.status !== 'awaiting_approval') {
          return NextResponse.json(
            { error: 'Withdrawal not found or not awaiting approval' },
            { status: 404 }
          );
        }
        
        // Reject in queue
        const rejected = await WithdrawalQueue.rejectWithdrawal(withdrawalId, adminWallet, rejectionReason);
        
        if (!rejected) {
          return NextResponse.json(
            { error: 'Failed to reject withdrawal' },
            { status: 500 }
          );
        }
        
        // Refund gems to user
        const userService = UserService.getInstance();
        await userService.updateBalance(
          rejected.walletAddress,
          rejected.gemsAmount,  // Refund full amount (including fee, since fee wasn't taken yet)
          `Refund from rejected withdrawal: ${rejectionReason}`
        );
        
        // Also cancel the transaction record if it exists
        await transactionsCollection.updateOne(
          { walletAddress: rejected.walletAddress, type: 'withdrawal', status: 'pending' },
          { 
            $set: { 
              status: 'cancelled', 
              notes: `Admin rejected: ${rejectionReason}`,
              cancelledAt: new Date()
            } 
          }
        );
        
        await auditService.log({
          walletAddress: rejected.walletAddress,
          action: 'withdrawal_rejected',
          description: `Admin rejected withdrawal ${withdrawalId}: ${rejectionReason}. Refunded ${rejected.gemsAmount} gems.`,
        });
        
        return NextResponse.json({
          success: true,
          action: 'reject_withdrawal',
          withdrawalId,
          walletAddress: rejected.walletAddress.slice(0, 8) + '...',
          refundedGems: rejected.gemsAmount,
          reason: rejectionReason,
          message: `Withdrawal rejected. ${rejected.gemsAmount} gems refunded to user.`
        });
      }
      
      case 'cancel_all_pending_withdrawals': {
        // Cancel ALL pending withdrawals and refund gems
        // Step 1: Get all pending withdrawals from transactions collection
        const pendingWithdrawals = await transactionsCollection.find({
          type: 'withdrawal',
          status: 'pending'
        }).toArray();
        
        let refundedGems = 0;
        const refundDetails: Array<{wallet: string; gems: number}> = [];
        
        // Step 2: Refund gems for each withdrawal
        const userSvc = UserService.getInstance();
        for (const withdrawal of pendingWithdrawals) {
          const refundAmount = withdrawal.gemsAmount;
          await userSvc.updateBalance(
            withdrawal.walletAddress,
            refundAmount,
            `Refund from cancelled pending withdrawal`
          );
          refundedGems += refundAmount;
          refundDetails.push({ 
            wallet: withdrawal.walletAddress.slice(0, 8), 
            gems: refundAmount 
          });
        }
        
        // Step 3: Mark all pending withdrawals as CANCELLED (keeps audit trail)
        const txResult = await transactionsCollection.updateMany(
          {
            type: 'withdrawal',
            status: 'pending'
          },
          {
            $set: {
              status: 'cancelled',
              notes: 'Admin cancelled: pending withdrawal cleanup with refund',
              cancelledAt: new Date()
            }
          }
        );
        
        // Step 4: Also cancel all awaiting_approval/pending/processing in withdrawal_queue
        const queueResult = await db.collection('withdrawal_queue').updateMany(
          { status: { $in: ['awaiting_approval', 'pending', 'processing'] } },
          { 
            $set: { 
              status: 'cancelled',
              queuePosition: null,
              processingLock: null,
              processingLockExpiry: null,
              failureReason: 'Admin cancelled'
            } 
          }
        );
        
        await auditService.log({
          action: 'admin_action',
          description: `CLEANUP: Cancelled ${txResult.modifiedCount} pending withdrawals, refunded ${refundedGems} gems, cancelled ${queueResult.modifiedCount} queue items`,
          newValue: { refundDetails }
        });
        
        return NextResponse.json({
          success: true,
          action: 'cancel_all_pending_withdrawals',
          cancelledTransactions: txResult.modifiedCount,
          cancelledQueueItems: queueResult.modifiedCount,
          refundedGems,
          refundDetails,
          message: `Cancelled ${txResult.modifiedCount} pending withdrawals, refunded ${refundedGems} gems`
        });
      }
      
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Admin API] POST Error:', message);
    
    return NextResponse.json(
      { error: `API Error: ${message}` },
      { status: 500 }
    );
  }
}
