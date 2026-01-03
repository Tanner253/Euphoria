/**
 * GET /api/admin
 * Admin dashboard data - DEVELOPMENT ONLY
 * 
 * Returns comprehensive live data from database for monitoring
 */

import { NextRequest, NextResponse } from 'next/server';
import { TransactionService, UserService, BetService, AuditService } from '@/lib/db/services';
import { connectToDatabase } from '@/lib/db/mongodb';

// SECURITY: Only available in development mode
function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
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
    ] = await Promise.all([
      userService.getUsersSummary(),
      transactionService.getTransactionStats(),
      betService.getBettingStats(),
      transactionService.getAllTransactions({ limit: txLimit }),
      userService.getAllUsers({ limit: userLimit, sortBy: 'lastActiveAt', sortOrder: 'desc' }),
      betService.getAllBets({ limit: betLimit }),
      auditService.getLogsByTimeRange(oneDayAgo, now, { limit: 100 }),
      transactionService.getAllTransactions({ limit: 1000, startDate: oneHourAgo, endDate: now }),
      transactionService.getAllTransactions({ limit: 1000, startDate: oneDayAgo, endDate: now }),
      betService.getAllBets({ limit: 1000, startDate: oneHourAgo, endDate: now }),
      betService.getAllBets({ limit: 1000, startDate: oneDayAgo, endDate: now }),
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
