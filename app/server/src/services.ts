/**
 * Server-Side Database Services
 * 
 * These services connect to MongoDB for server-authoritative operations:
 * - Bet placement with balance validation
 * - Bet resolution with payout
 * - Balance management
 * - Admin data fetching
 */

import { Collection, ObjectId, Db } from 'mongodb';
import { connectToDatabase } from './database.js';

// ============ TYPES ============

export interface User {
  _id?: ObjectId;
  walletAddress: string;
  gemsBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  totalWagered: number;
  totalWon: number;
  totalLost: number;
  biggestWin: number;
  createdAt: Date;
  lastActiveAt: Date;
  status: 'active' | 'suspended' | 'banned';
}

export interface Bet {
  _id?: ObjectId;
  walletAddress: string;
  sessionId: string;
  amount: number;
  multiplier: number;
  potentialWin: number;
  columnId: string;
  yIndex: number;
  basePrice: number;
  cellSize: number;
  priceAtBet: number;
  winPriceMin: number;
  winPriceMax: number;
  status: 'pending' | 'won' | 'lost' | 'expired' | 'cancelled';
  actualWin?: number;
  priceAtResolution?: number;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface Transaction {
  _id?: ObjectId;
  walletAddress: string;
  type: 'deposit' | 'withdrawal';
  status: 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'awaiting_approval';
  solAmount: number;
  gemsAmount: number;
  feeAmount?: number;
  txSignature?: string;
  createdAt: Date;
  confirmedAt?: Date;
  notes?: string;
}

export interface AuditLog {
  _id?: ObjectId;
  walletAddress?: string;
  action: string;
  description: string;
  previousValue?: unknown;
  newValue?: unknown;
  relatedId?: string;
  relatedCollection?: string;
  createdAt: Date;
}

// ============ USER SERVICE ============

export class UserServiceServer {
  private static instance: UserServiceServer | null = null;

  private constructor() {}

  static getInstance(): UserServiceServer {
    if (!UserServiceServer.instance) {
      UserServiceServer.instance = new UserServiceServer();
    }
    return UserServiceServer.instance;
  }

  private async getCollection(): Promise<Collection<User>> {
    const { db } = await connectToDatabase();
    return db.collection<User>('users');
  }

  async getUser(walletAddress: string): Promise<User | null> {
    const collection = await this.getCollection();
    return collection.findOne({ walletAddress });
  }

  async updateBalance(
    walletAddress: string,
    delta: number,
    reason: string
  ): Promise<{ success: boolean; newBalance: number }> {
    const collection = await this.getCollection();
    
    const user = await collection.findOne({ walletAddress });
    if (!user) {
      return { success: false, newBalance: 0 };
    }
    
    const newBalance = user.gemsBalance + delta;
    
    // Prevent negative balance
    if (newBalance < 0) {
      return { success: false, newBalance: user.gemsBalance };
    }
    
    await collection.updateOne(
      { walletAddress },
      { 
        $set: { 
          gemsBalance: newBalance,
          lastActiveAt: new Date()
        }
      }
    );
    
    // Log balance change
    await AuditServiceServer.getInstance().log({
      walletAddress,
      action: 'balance_adjusted',
      description: reason,
      previousValue: user.gemsBalance,
      newValue: newBalance,
    });
    
    return { success: true, newBalance };
  }

  async recordBetResult(
    walletAddress: string,
    betAmount: number,
    winAmount: number,
    isWin: boolean
  ): Promise<void> {
    const collection = await this.getCollection();
    
    const updateFields: Record<string, number> = {
      totalBets: 1,
      totalWagered: betAmount,
    };
    
    if (isWin) {
      updateFields.totalWins = 1;
      updateFields.totalWon = winAmount;
    } else {
      updateFields.totalLosses = 1;
      updateFields.totalLost = betAmount;
    }
    
    await collection.updateOne(
      { walletAddress },
      {
        $inc: updateFields,
        $set: { lastActiveAt: new Date() },
        ...(isWin && winAmount > 0 ? {
          $max: { biggestWin: winAmount }
        } : {})
      }
    );
  }
}

// ============ BET SERVICE ============

export class BetServiceServer {
  private static instance: BetServiceServer | null = null;

  private constructor() {}

  static getInstance(): BetServiceServer {
    if (!BetServiceServer.instance) {
      BetServiceServer.instance = new BetServiceServer();
    }
    return BetServiceServer.instance;
  }

  private async getCollection(): Promise<Collection<Bet>> {
    const { db } = await connectToDatabase();
    return db.collection<Bet>('bets');
  }

  /**
   * Place a bet - validates balance, deducts gems, records to database
   */
  async placeBet(params: {
    walletAddress: string;
    sessionId: string;
    amount: number;
    multiplier: number;
    columnId: string;
    yIndex: number;
    basePrice: number;
    cellSize: number;
    priceAtBet: number;
    winPriceMin: number;
    winPriceMax: number;
  }): Promise<{ success: boolean; bet?: Bet; error?: string; newBalance?: number }> {
    const userService = UserServiceServer.getInstance();
    
    // Validate user and balance
    const user = await userService.getUser(params.walletAddress);
    if (!user) {
      return { success: false, error: 'User not found' };
    }
    
    if (user.status !== 'active') {
      return { success: false, error: 'Account is suspended' };
    }
    
    if (user.gemsBalance < params.amount) {
      return { success: false, error: 'Insufficient balance', newBalance: user.gemsBalance };
    }
    
    // Validate bet amount
    if (params.amount < 1 || params.amount > 100) {
      return { success: false, error: 'Bet amount must be 1-100 gems' };
    }
    
    // Deduct balance first
    const balanceResult = await userService.updateBalance(
      params.walletAddress,
      -params.amount,
      `Bet placed: ${params.amount} gems at ${params.multiplier.toFixed(2)}x`
    );
    
    if (!balanceResult.success) {
      return { success: false, error: 'Failed to deduct balance' };
    }
    
    // Create bet record
    const collection = await this.getCollection();
    
    const bet: Bet = {
      walletAddress: params.walletAddress,
      sessionId: params.sessionId,
      amount: params.amount,
      multiplier: Math.round(params.multiplier * 100) / 100,
      potentialWin: params.amount * params.multiplier,
      columnId: params.columnId,
      yIndex: params.yIndex,
      basePrice: params.basePrice,
      cellSize: params.cellSize,
      priceAtBet: params.priceAtBet,
      winPriceMin: params.winPriceMin,
      winPriceMax: params.winPriceMax,
      status: 'pending',
      createdAt: new Date(),
    };
    
    const result = await collection.insertOne(bet);
    bet._id = result.insertedId;
    
    await AuditServiceServer.getInstance().log({
      walletAddress: params.walletAddress,
      action: 'bet_placed',
      description: `Bet placed: ${params.amount} gems at ${params.multiplier.toFixed(2)}x`,
      relatedId: result.insertedId.toString(),
      relatedCollection: 'bets',
      newValue: {
        amount: params.amount,
        multiplier: params.multiplier,
        potentialWin: bet.potentialWin
      },
    });
    
    return { success: true, bet, newBalance: balanceResult.newBalance };
  }

  /**
   * Resolve a bet - determine win/loss, credit winnings
   */
  async resolveBet(
    betId: string,
    isWin: boolean,
    priceAtResolution: number
  ): Promise<{ success: boolean; bet?: Bet; newBalance?: number }> {
    const collection = await this.getCollection();
    
    const bet = await collection.findOne({ 
      _id: new ObjectId(betId),
      status: 'pending'
    });
    
    if (!bet) {
      return { success: false };
    }
    
    const status = isWin ? 'won' : 'lost';
    const actualWin = isWin ? bet.potentialWin : 0;
    
    // Update bet
    await collection.updateOne(
      { _id: new ObjectId(betId) },
      {
        $set: {
          status,
          priceAtResolution,
          actualWin,
          resolvedAt: new Date()
        }
      }
    );
    
    const userService = UserServiceServer.getInstance();
    let newBalance = 0;
    
    // Credit winnings if won
    if (isWin) {
      const balanceResult = await userService.updateBalance(
        bet.walletAddress,
        actualWin,
        `Bet won: +${actualWin} gems`
      );
      newBalance = balanceResult.newBalance;
    } else {
      // Get current balance for notification
      const user = await userService.getUser(bet.walletAddress);
      newBalance = user?.gemsBalance || 0;
    }
    
    // Update user stats
    await userService.recordBetResult(
      bet.walletAddress,
      bet.amount,
      actualWin,
      isWin
    );
    
    await AuditServiceServer.getInstance().log({
      walletAddress: bet.walletAddress,
      action: 'bet_resolved',
      description: isWin 
        ? `Bet won: +${actualWin} gems` 
        : `Bet lost: -${bet.amount} gems`,
      relatedId: betId,
      relatedCollection: 'bets',
      previousValue: { status: 'pending' },
      newValue: { status, actualWin, priceAtResolution },
    });
    
    const updatedBet = await collection.findOne({ _id: new ObjectId(betId) });
    return { success: true, bet: updatedBet || undefined, newBalance };
  }

  async getBet(betId: string): Promise<Bet | null> {
    const collection = await this.getCollection();
    return collection.findOne({ _id: new ObjectId(betId) });
  }

  async getBettingStats(): Promise<{
    totalBets: number;
    totalWins: number;
    totalLosses: number;
    totalWagered: number;
    totalPaidOut: number;
  }> {
    const collection = await this.getCollection();
    
    interface BettingStatsResult {
      totalBets: number;
      totalWins: number;
      totalLosses: number;
      totalWagered: number;
      totalPaidOut: number;
    }
    
    const pipeline = [
      { $match: { status: { $in: ['won', 'lost'] } } },
      {
        $group: {
          _id: null,
          totalBets: { $sum: 1 },
          totalWins: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
          totalLosses: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
          totalWagered: { $sum: '$amount' },
          totalPaidOut: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, '$actualWin', 0] } }
        }
      }
    ];
    
    const result = await collection.aggregate<BettingStatsResult>(pipeline).toArray();
    const stats = result[0];
    
    return {
      totalBets: stats?.totalBets ?? 0,
      totalWins: stats?.totalWins ?? 0,
      totalLosses: stats?.totalLosses ?? 0,
      totalWagered: stats?.totalWagered ?? 0,
      totalPaidOut: stats?.totalPaidOut ?? 0,
    };
  }
}

// ============ AUDIT SERVICE ============

export class AuditServiceServer {
  private static instance: AuditServiceServer | null = null;

  private constructor() {}

  static getInstance(): AuditServiceServer {
    if (!AuditServiceServer.instance) {
      AuditServiceServer.instance = new AuditServiceServer();
    }
    return AuditServiceServer.instance;
  }

  private async getCollection(): Promise<Collection<AuditLog>> {
    const { db } = await connectToDatabase();
    return db.collection<AuditLog>('auditLog');
  }

  async log(entry: Omit<AuditLog, '_id' | 'createdAt'>): Promise<void> {
    try {
      const collection = await this.getCollection();
      await collection.insertOne({
        ...entry,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error('[Audit] Failed to log:', err);
    }
  }
}

// ============ ADMIN DATA SERVICE ============

export class AdminDataService {
  static async getDashboardData(): Promise<{
    stats: {
      users: { total: number; active24h: number; gemsInCirculation: number };
      betting: { totalBets: number; totalWins: number; totalLosses: number; totalWagered: number; totalPaidOut: number; houseProfit: number };
    };
    transactions: Transaction[];
    users: User[];
    bets: Bet[];
    alerts: Array<{ type: string; message: string; timestamp: string }>;
  }> {
    const { db } = await connectToDatabase();
    
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Fetch all data in parallel
    const [users, transactions, bets, bettingStats] = await Promise.all([
      db.collection<User>('users').find().sort({ lastActiveAt: -1 }).limit(50).toArray(),
      db.collection<Transaction>('transactions').find().sort({ createdAt: -1 }).limit(50).toArray(),
      db.collection<Bet>('bets').find().sort({ createdAt: -1 }).limit(50).toArray(),
      BetServiceServer.getInstance().getBettingStats(),
    ]);
    
    const activeUsers24h = users.filter(u => u.lastActiveAt >= oneDayAgo).length;
    const gemsInCirculation = users.reduce((sum, u) => sum + u.gemsBalance, 0);
    
    const alerts: Array<{ type: string; message: string; timestamp: string }> = [];
    
    // Check for failed transactions
    const failedTx = transactions.filter(tx => tx.status === 'failed');
    failedTx.forEach(tx => {
      alerts.push({
        type: 'error',
        message: `${tx.type.toUpperCase()} failed: ${tx.walletAddress.slice(0, 8)}...`,
        timestamp: tx.createdAt.toISOString(),
      });
    });
    
    return {
      stats: {
        users: {
          total: users.length,
          active24h: activeUsers24h,
          gemsInCirculation,
        },
        betting: {
          ...bettingStats,
          houseProfit: bettingStats.totalWagered - bettingStats.totalPaidOut,
        },
      },
      transactions,
      users,
      bets,
      alerts,
    };
  }
}

