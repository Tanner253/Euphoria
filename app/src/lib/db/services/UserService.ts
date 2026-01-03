/**
 * UserService - Handles user-related database operations
 * 
 * SECURITY: Server-authoritative - all validations happen here
 */

import { Collection, ObjectId } from 'mongodb';
import { connectToDatabase } from '../mongodb';
import { User, UserStats } from '../models/types';
import { AuditService } from './AuditService';

// SECURITY: Initial gems balance is 0 - users must deposit to get real gems
// Demo mode uses separate client-side balance
const INITIAL_GEMS_BALANCE = 0;

export class UserService {
  private static instance: UserService | null = null;
  private collection: Collection<User> | null = null;

  private constructor() {}

  static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService();
    }
    return UserService.instance;
  }

  private async getCollection(): Promise<Collection<User>> {
    if (!this.collection) {
      const { db } = await connectToDatabase();
      this.collection = db.collection<User>('users');
    }
    return this.collection;
  }

  /**
   * Find or create a user by wallet address
   * Called after x403 authentication
   */
  async findOrCreateUser(
    walletAddress: string,
    metadata?: { ipAddress?: string; userAgent?: string }
  ): Promise<{ user: User; isNew: boolean }> {
    const collection = await this.getCollection();
    
    // Try to find existing user
    const user = await collection.findOne({ walletAddress });
    
    if (user) {
      // Update last active and auth time
      await collection.updateOne(
        { walletAddress },
        { 
          $set: { 
            lastActiveAt: new Date(),
            lastAuthAt: new Date()
          } 
        }
      );
      
      // Log authentication
      await AuditService.getInstance().log({
        walletAddress,
        action: 'user_authenticated',
        description: 'User authenticated via x403',
        ipAddress: metadata?.ipAddress,
        userAgent: metadata?.userAgent,
      });
      
      return { user, isNew: false };
    }
    
    // Create new user with 0 gems (must deposit to get real gems)
    const newUser: User = {
      walletAddress,
      gemsBalance: INITIAL_GEMS_BALANCE,
      totalDeposited: 0,
      totalWithdrawn: 0,
      totalBets: 0,
      totalWins: 0,
      totalLosses: 0,
      totalWagered: 0,
      totalWon: 0,
      totalLost: 0,
      biggestWin: 0,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      lastAuthAt: new Date(),
      status: 'active',
      firstIpAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
    };
    
    const result = await collection.insertOne(newUser);
    newUser._id = result.insertedId;
    
    // Log user creation
    await AuditService.getInstance().log({
      walletAddress,
      action: 'user_created',
      description: `New user created with ${INITIAL_GEMS_BALANCE} gems`,
      newValue: { gemsBalance: INITIAL_GEMS_BALANCE },
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
    });
    
    return { user: newUser, isNew: true };
  }

  /**
   * Get user by wallet address
   */
  async getUser(walletAddress: string): Promise<User | null> {
    const collection = await this.getCollection();
    return collection.findOne({ walletAddress });
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<User | null> {
    const collection = await this.getCollection();
    return collection.findOne({ _id: new ObjectId(id) });
  }

  /**
   * Update user's gems balance
   */
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
    await AuditService.getInstance().log({
      walletAddress,
      action: 'balance_adjusted',
      description: reason,
      previousValue: user.gemsBalance,
      newValue: newBalance,
    });
    
    return { success: true, newBalance };
  }

  /**
   * Record a deposit (update totalDeposited)
   */
  async recordDeposit(walletAddress: string, solAmount: number): Promise<void> {
    const collection = await this.getCollection();
    
    await collection.updateOne(
      { walletAddress },
      {
        $inc: { totalDeposited: solAmount },
        $set: { lastActiveAt: new Date() }
      }
    );
  }

  /**
   * Record a withdrawal (update totalWithdrawn)
   */
  async recordWithdrawal(walletAddress: string, solAmount: number): Promise<void> {
    const collection = await this.getCollection();
    
    await collection.updateOne(
      { walletAddress },
      {
        $inc: { totalWithdrawn: solAmount },
        $set: { lastActiveAt: new Date() }
      }
    );
  }

  /**
   * Record a bet result and update user stats
   */
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
    
    // Update stats
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

  /**
   * Get user stats for display
   */
  async getUserStats(walletAddress: string): Promise<UserStats | null> {
    const user = await this.getUser(walletAddress);
    if (!user) return null;
    
    const winRate = user.totalBets > 0 
      ? (user.totalWins / user.totalBets) * 100 
      : 0;
    
    return {
      walletAddress: user.walletAddress,
      gemsBalance: user.gemsBalance,
      totalBets: user.totalBets,
      winRate: Math.round(winRate * 100) / 100,
      totalWagered: user.totalWagered,
      netProfit: user.totalWon - user.totalLost,
      biggestWin: user.biggestWin,
    };
  }

  /**
   * Get active users count (last 24 hours)
   */
  async getActiveUsersCount(): Promise<number> {
    const collection = await this.getCollection();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    return collection.countDocuments({
      lastActiveAt: { $gte: oneDayAgo }
    });
  }

  /**
   * Get all users (admin use - development only)
   */
  async getAllUsers(options?: {
    limit?: number;
    skip?: number;
    status?: 'active' | 'suspended' | 'banned';
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<User[]> {
    const collection = await this.getCollection();
    
    const query: Record<string, unknown> = {};
    if (options?.status) query.status = options.status;
    
    const sort: Record<string, 1 | -1> = {};
    if (options?.sortBy) {
      sort[options.sortBy] = options.sortOrder === 'asc' ? 1 : -1;
    } else {
      sort.lastActiveAt = -1;
    }
    
    return collection
      .find(query)
      .sort(sort)
      .skip(options?.skip || 0)
      .limit(options?.limit || 100)
      .toArray();
  }

  /**
   * Get user statistics summary (admin use)
   */
  async getUsersSummary(): Promise<{
    totalUsers: number;
    activeUsers24h: number;
    totalGemsInCirculation: number;
    totalDeposited: number;
    totalWithdrawn: number;
  }> {
    const collection = await this.getCollection();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const pipeline = [
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalUsers: { $sum: 1 },
                totalGems: { $sum: '$gemsBalance' },
                totalDeposited: { $sum: '$totalDeposited' },
                totalWithdrawn: { $sum: '$totalWithdrawn' }
              }
            }
          ],
          active: [
            { $match: { lastActiveAt: { $gte: oneDayAgo } } },
            { $count: 'count' }
          ]
        }
      }
    ];
    
    interface SummaryResult {
      totals: Array<{
        totalUsers: number;
        totalGems: number;
        totalDeposited: number;
        totalWithdrawn: number;
      }>;
      active: Array<{ count: number }>;
    }
    
    const result = await collection.aggregate<SummaryResult>(pipeline).toArray();
    const data = result[0];
    
    return {
      totalUsers: data.totals[0]?.totalUsers || 0,
      activeUsers24h: data.active[0]?.count || 0,
      totalGemsInCirculation: data.totals[0]?.totalGems || 0,
      totalDeposited: data.totals[0]?.totalDeposited || 0,
      totalWithdrawn: data.totals[0]?.totalWithdrawn || 0,
    };
  }

  /**
   * Suspend a user
   */
  async suspendUser(
    walletAddress: string,
    reason: string,
    performedBy?: string
  ): Promise<boolean> {
    const collection = await this.getCollection();
    
    const result = await collection.updateOne(
      { walletAddress },
      {
        $set: {
          status: 'suspended',
          suspensionReason: reason
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      await AuditService.getInstance().log({
        walletAddress,
        action: 'user_suspended',
        description: `User suspended: ${reason}`,
        performedBy,
      });
      return true;
    }
    
    return false;
  }

  /**
   * Unsuspend a user
   */
  async unsuspendUser(
    walletAddress: string,
    performedBy?: string
  ): Promise<boolean> {
    const collection = await this.getCollection();
    
    const result = await collection.updateOne(
      { walletAddress, status: 'suspended' },
      {
        $set: { status: 'active' },
        $unset: { suspensionReason: '' }
      }
    );
    
    if (result.modifiedCount > 0) {
      await AuditService.getInstance().log({
        walletAddress,
        action: 'admin_action',
        description: 'User unsuspended',
        performedBy,
      });
      return true;
    }
    
    return false;
  }
}
