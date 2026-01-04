/**
 * BetService - Handles bet tracking and resolution
 */

import { Collection, ObjectId } from 'mongodb';
import { connectToDatabase } from '../mongodb';
import { Bet, BetStatus } from '../models/types';
import { UserService } from './UserService';
import { AuditService } from './AuditService';

export class BetService {
  private static instance: BetService | null = null;

  private constructor() {}

  static getInstance(): BetService {
    if (!BetService.instance) {
      BetService.instance = new BetService();
    }
    return BetService.instance;
  }

  // Always get fresh collection to handle reconnections
  private async getCollection(): Promise<Collection<Bet>> {
    const { db } = await connectToDatabase();
    return db.collection<Bet>('bets');
  }

  /**
   * Record a new bet
   */
  async placeBet(params: {
    walletAddress: string;
    sessionId: string;
    amount: number;
    multiplier: number;
    columnId: string;
    yIndex: number;
    basePrice: number;    // Client's grid anchor price
    cellSize: number;     // Cell size at bet time (for reference)
    priceAtBet: number;
    winPriceMin: number;  // GRID-ALIGNED: Min price for win
    winPriceMax: number;  // GRID-ALIGNED: Max price for win
    clientHash?: string;
  }): Promise<{ success: boolean; bet?: Bet; error?: string }> {
    // Validate user balance
    const user = await UserService.getInstance().getUser(params.walletAddress);
    if (!user || user.gemsBalance < params.amount) {
      return { success: false, error: 'Insufficient balance' };
    }
    
    const collection = await this.getCollection();
    
    const bet: Bet = {
      walletAddress: params.walletAddress,
      sessionId: params.sessionId,
      amount: params.amount,
      multiplier: params.multiplier,
      potentialWin: params.amount * params.multiplier,
      columnId: params.columnId,
      yIndex: params.yIndex,
      basePrice: params.basePrice,    // Grid anchor for resolution
      cellSize: params.cellSize,       // Cell size for reference
      priceAtBet: params.priceAtBet,
      winPriceMin: params.winPriceMin,  // Exact grid-aligned boundaries
      winPriceMax: params.winPriceMax,
      status: 'pending',
      clientHash: params.clientHash,
      createdAt: new Date(),
    };
    
    // Deduct bet amount from balance
    const balanceResult = await UserService.getInstance().updateBalance(
      params.walletAddress,
      -params.amount,
      `Bet placed: ${params.amount} gems at ${params.multiplier}x`
    );
    
    if (!balanceResult.success) {
      return { success: false, error: 'Failed to deduct balance' };
    }
    
    const result = await collection.insertOne(bet);
    bet._id = result.insertedId;
    
    await AuditService.getInstance().log({
      walletAddress: params.walletAddress,
      action: 'bet_placed',
      description: `Bet placed: ${params.amount} gems at ${params.multiplier}x`,
      relatedId: result.insertedId.toString(),
      relatedCollection: 'bets',
      newValue: {
        amount: params.amount,
        multiplier: params.multiplier,
        potentialWin: bet.potentialWin
      },
    });
    
    return { success: true, bet };
  }

  /**
   * OPTIMIZED: Place multiple bets in a single batch operation
   * Reduces database operations from 4*N to ~4 total
   */
  async placeBetBatch(
    walletAddress: string,
    sessionId: string,
    priceAtBet: number,
    bets: Array<{
      columnId: string;
      yIndex: number;
      basePrice: number;
      cellSize: number;
      amount: number;
      multiplier: number;
      winPriceMin: number;
      winPriceMax: number;
    }>
  ): Promise<{ 
    success: boolean; 
    results: Array<{ index: number; success: boolean; betId?: string; error?: string }>;
    totalDeducted: number;
    error?: string;
  }> {
    if (bets.length === 0) {
      return { success: false, results: [], totalDeducted: 0, error: 'No bets provided' };
    }

    // Calculate total amount needed
    const totalAmount = bets.reduce((sum, bet) => sum + bet.amount, 0);

    // ONE balance deduction for all bets
    const balanceResult = await UserService.getInstance().updateBalance(
      walletAddress,
      -totalAmount,
      `Batch bet: ${bets.length} bets totaling ${totalAmount} gems`
    );

    if (!balanceResult.success) {
      return { success: false, results: [], totalDeducted: 0, error: 'Insufficient balance' };
    }

    // Prepare all bet documents
    const collection = await this.getCollection();
    const now = new Date();
    const betDocs: Bet[] = bets.map(bet => ({
      walletAddress,
      sessionId,
      amount: bet.amount,
      multiplier: bet.multiplier,
      potentialWin: bet.amount * bet.multiplier,
      columnId: bet.columnId,
      yIndex: bet.yIndex,
      basePrice: bet.basePrice,
      cellSize: bet.cellSize,
      priceAtBet,
      winPriceMin: bet.winPriceMin,
      winPriceMax: bet.winPriceMax,
      status: 'pending' as const,
      createdAt: now,
    }));

    // ONE insertMany for all bets
    const insertResult = await collection.insertMany(betDocs);

    // Build results with inserted IDs
    const results = bets.map((bet, index) => ({
      index,
      success: true,
      betId: insertResult.insertedIds[index]?.toString(),
      winPriceMin: bet.winPriceMin,
      winPriceMax: bet.winPriceMax,
    }));

    // ONE audit log for entire batch
    await AuditService.getInstance().log({
      walletAddress,
      action: 'bet_placed',
      description: `Batch: ${bets.length} bets, ${totalAmount} gems total`,
      newValue: {
        count: bets.length,
        totalAmount,
        bets: bets.map((b, i) => ({ 
          id: results[i].betId,
          amount: b.amount,
          multiplier: b.multiplier 
        }))
      },
    });

    return { success: true, results, totalDeducted: totalAmount };
  }

  /**
   * Resolve a bet (win or lose)
   */
  async resolveBet(
    betId: string,
    isWin: boolean,
    priceAtResolution: number,
    serverHash?: string
  ): Promise<{ success: boolean; bet?: Bet }> {
    const collection = await this.getCollection();
    
    const bet = await collection.findOne({ 
      _id: new ObjectId(betId),
      status: 'pending'
    });
    
    if (!bet) {
      return { success: false };
    }
    
    const status: BetStatus = isWin ? 'won' : 'lost';
    const actualWin = isWin ? bet.potentialWin : 0;
    
    // Update bet
    await collection.updateOne(
      { _id: new ObjectId(betId) },
      {
        $set: {
          status,
          priceAtResolution,
          actualWin,
          serverHash,
          resolvedAt: new Date()
        }
      }
    );
    
    // Credit winnings if won
    if (isWin) {
      await UserService.getInstance().updateBalance(
        bet.walletAddress,
        actualWin,
        `Bet won: +${actualWin} gems`
      );
    }
    
    // Update user stats
    await UserService.getInstance().recordBetResult(
      bet.walletAddress,
      bet.amount,
      actualWin,
      isWin
    );
    
    await AuditService.getInstance().log({
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
    return { success: true, bet: updatedBet || undefined };
  }

  /**
   * Get bet by ID
   */
  async getBet(betId: string): Promise<Bet | null> {
    const collection = await this.getCollection();
    return collection.findOne({ _id: new ObjectId(betId) });
  }

  /**
   * Get user's bet history
   */
  async getUserBets(
    walletAddress: string,
    options?: { 
      status?: BetStatus; 
      sessionId?: string;
      limit?: number; 
      skip?: number 
    }
  ): Promise<Bet[]> {
    const collection = await this.getCollection();
    
    const query: Record<string, unknown> = { walletAddress };
    if (options?.status) query.status = options.status;
    if (options?.sessionId) query.sessionId = options.sessionId;
    
    return collection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(options?.skip || 0)
      .limit(options?.limit || 100)
      .toArray();
  }

  /**
   * Get pending bets for a session
   */
  async getPendingBets(sessionId: string): Promise<Bet[]> {
    const collection = await this.getCollection();
    return collection.find({ sessionId, status: 'pending' }).toArray();
  }

  /**
   * Cancel a pending bet (refund)
   */
  async cancelBet(betId: string, reason: string): Promise<boolean> {
    const collection = await this.getCollection();
    
    const bet = await collection.findOne({ 
      _id: new ObjectId(betId),
      status: 'pending'
    });
    
    if (!bet) return false;
    
    await collection.updateOne(
      { _id: new ObjectId(betId) },
      { $set: { status: 'cancelled' as BetStatus } }
    );
    
    // Refund bet amount
    await UserService.getInstance().updateBalance(
      bet.walletAddress,
      bet.amount,
      `Bet cancelled: +${bet.amount} gems refunded - ${reason}`
    );
    
    return true;
  }

  /**
   * Expire old pending bets
   */
  async expireOldBets(maxAgeMinutes: number = 5): Promise<number> {
    const collection = await this.getCollection();
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
    
    const expiredBets = await collection.find({
      status: 'pending',
      createdAt: { $lt: cutoffTime }
    }).toArray();
    
    for (const bet of expiredBets) {
      await collection.updateOne(
        { _id: bet._id },
        { $set: { status: 'expired' as BetStatus } }
      );
      
      // Refund expired bets
      await UserService.getInstance().updateBalance(
        bet.walletAddress,
        bet.amount,
        `Bet expired: +${bet.amount} gems refunded`
      );
    }
    
    return expiredBets.length;
  }

  /**
   * Get all bets (admin use - development only)
   */
  async getAllBets(options?: {
    limit?: number;
    skip?: number;
    status?: BetStatus;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Bet[]> {
    const collection = await this.getCollection();
    
    const query: Record<string, unknown> = {};
    if (options?.status) query.status = options.status;
    if (options?.startDate || options?.endDate) {
      query.createdAt = {};
      if (options.startDate) (query.createdAt as Record<string, Date>).$gte = options.startDate;
      if (options.endDate) (query.createdAt as Record<string, Date>).$lte = options.endDate;
    }
    
    return collection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(options?.skip || 0)
      .limit(options?.limit || 100)
      .toArray();
  }

  /**
   * Get betting statistics
   */
  async getBettingStats(walletAddress?: string): Promise<{
    totalBets: number;
    totalWins: number;
    totalLosses: number;
    totalWagered: number;
    totalPaidOut: number;
  }> {
    const collection = await this.getCollection();
    
    const match = walletAddress ? { walletAddress } : {};
    
    const pipeline = [
      { $match: { ...match, status: { $in: ['won', 'lost'] } } },
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
    
    interface BettingStatsResult {
      totalBets: number;
      totalWins: number;
      totalLosses: number;
      totalWagered: number;
      totalPaidOut: number;
    }
    
    const result = await collection.aggregate<BettingStatsResult>(pipeline).toArray();
    
    // Defensive: handle empty database
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

