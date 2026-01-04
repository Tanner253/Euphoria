/**
 * TransactionService - Handles deposit and withdrawal transactions
 * 
 * SECURITY: Server-authoritative - all validations happen here
 */

import { Collection, ObjectId } from 'mongodb';
import { connectToDatabase } from '../mongodb';
import { Transaction, TransactionType, TransactionStatus } from '../models/types';
import { UserService } from './UserService';
import { AuditService } from './AuditService';
import logger from '@/lib/utils/secureLogger';

// Economy config from environment with defaults
export const getGemsPerSol = () => Number(process.env.GEMS_PER_SOL) || 1000;
export const getWithdrawalFee = () => Number(process.env.WITHDRAWAL_FEE_PERCENT) || 0.02;
const getMinWithdrawal = () => Number(process.env.MIN_WITHDRAWAL_GEMS) || 100;
const getCustodialAddress = () => process.env.CUSTODIAL_WALLET_ADDRESS || '';

// SECURITY: Rate limiting - max 1 withdrawal per minute
const WITHDRAWAL_COOLDOWN_MS = 60 * 1000;

// SECURITY: Withdrawal limits
const MAX_DAILY_WITHDRAWAL_SOL = Number(process.env.MAX_DAILY_WITHDRAWAL_SOL) || 5; // 5 SOL per day default
const MAX_SINGLE_WITHDRAWAL_SOL = Number(process.env.MAX_SINGLE_WITHDRAWAL_SOL) || 2; // 2 SOL max per withdrawal

export class TransactionService {
  private static instance: TransactionService | null = null;
  private indexesEnsured = false;

  private constructor() {}

  static getInstance(): TransactionService {
    if (!TransactionService.instance) {
      TransactionService.instance = new TransactionService();
    }
    return TransactionService.instance;
  }

  // Always get fresh collection to handle reconnections
  private async getCollection(): Promise<Collection<Transaction>> {
    const { db } = await connectToDatabase();
    const collection = db.collection<Transaction>('transactions');
    
    // Ensure indexes once per instance lifetime
    if (!this.indexesEnsured) {
      try {
        // Unique index on txSignature (sparse - only indexed when field exists)
        await collection.createIndex(
          { txSignature: 1 }, 
          { unique: true, sparse: true }
        );
        
        // SECURITY: Partial unique index - only ONE pending withdrawal per wallet
        // This prevents race conditions at the database level
        await collection.createIndex(
          { walletAddress: 1, type: 1, status: 1 },
          { 
            unique: true, 
            partialFilterExpression: { 
              type: 'withdrawal', 
              status: 'pending' 
            },
            name: 'unique_pending_withdrawal_per_wallet'
          }
        );
        
        // Index for faster pending withdrawal lookups
        await collection.createIndex(
          { walletAddress: 1, type: 1, status: 1 }
        );
        
        logger.info('[TransactionService] Indexes ensured');
      } catch (err) {
        // Index may already exist - this is fine
        const mongoError = err as { code?: number };
        if (mongoError.code !== 85 && mongoError.code !== 86) { // IndexOptionsConflict or IndexKeySpecsConflict
          logger.warn('[TransactionService] Index creation warning', { error: String(err) });
        }
      }
      
      this.indexesEnsured = true;
    }
    
    return collection;
  }

  /**
   * Get custodial wallet address for deposits
   */
  getCustodialWalletAddress(): string {
    return getCustodialAddress();
  }

  /**
   * Calculate gems for a given SOL amount
   */
  calculateGemsForSol(solAmount: number): number {
    return Math.floor((solAmount / 1e9) * getGemsPerSol());
  }

  /**
   * Find a transaction by its on-chain signature
   * Used to prevent double-processing
   */
  async findBySignature(txSignature: string): Promise<Transaction | null> {
    const collection = await this.getCollection();
    return collection.findOne({ txSignature });
  }

  /**
   * Create a deposit transaction atomically
   * SECURITY: Uses findOneAndUpdate with upsert to prevent duplicate deposits
   * The txSignature unique index ensures only one record per transaction
   */
  async createDeposit(
    walletAddress: string,
    solAmount: number, // in lamports
    txSignature: string // REQUIRED: Must have signature for atomic creation
  ): Promise<{ transaction: Transaction; isNew: boolean }> {
    const collection = await this.getCollection();
    
    const gemsAmount = this.calculateGemsForSol(solAmount);
    
    // SECURITY: Atomic upsert - creates new OR returns existing
    // The unique index on txSignature prevents duplicates
    const result = await collection.findOneAndUpdate(
      { txSignature }, // Find by signature
      {
        $setOnInsert: {
          walletAddress,
          type: 'deposit' as const,
          status: 'pending' as const,
          solAmount,
          gemsAmount,
          txSignature,
          destinationAddress: getCustodialAddress(),
          createdAt: new Date(),
        }
      },
      { 
        upsert: true, 
        returnDocument: 'after' 
      }
    );
    
    const transaction = result!;
    const isNew = !result?.confirmedAt; // If no confirmedAt, it was just created
    
    // Only log if this is a new deposit
    if (isNew && transaction.status === 'pending') {
      await AuditService.getInstance().log({
        walletAddress,
        action: 'deposit_initiated',
        description: `Deposit initiated: ${solAmount / 1e9} SOL = ${gemsAmount} gems`,
        relatedId: transaction._id!.toString(),
        relatedCollection: 'transactions',
        newValue: { solAmount, gemsAmount, txSignature: txSignature.slice(0, 16) },
      });
    }
    
    return { transaction, isNew };
  }

  /**
   * Confirm a deposit after blockchain verification
   */
  async confirmDeposit(
    transactionId: string,
    txSignature: string,
    blockTime: number,
    slot: number
  ): Promise<{ success: boolean; transaction?: Transaction; error?: string }> {
    const collection = await this.getCollection();
    
    const transaction = await collection.findOne({ 
      _id: new ObjectId(transactionId),
      status: 'pending',
      type: 'deposit'
    });
    
    if (!transaction) {
      return { success: false, error: 'Transaction not found' };
    }
    
    // SECURITY: Check if this signature is already used
    const existingWithSig = await collection.findOne({ 
      txSignature,
      _id: { $ne: new ObjectId(transactionId) }
    });
    
    if (existingWithSig) {
      logger.warn('[Transaction] Duplicate signature detected', {
        wallet: transaction.walletAddress.slice(0, 8),
        sig: txSignature.slice(0, 16)
      });
      return { success: false, error: 'Transaction already processed' };
    }
    
    // Update transaction status
    try {
      await collection.updateOne(
        { _id: new ObjectId(transactionId) },
        {
          $set: {
            status: 'confirmed' as TransactionStatus,
            txSignature,
            blockTime,
            slot,
            confirmedAt: new Date()
          }
        }
      );
    } catch {
      // Unique constraint violation - signature already exists
      logger.warn('[Transaction] Signature conflict', {
        wallet: transaction.walletAddress.slice(0, 8)
      });
      return { success: false, error: 'Transaction already processed' };
    }
    
    // Credit user's balance
    await UserService.getInstance().updateBalance(
      transaction.walletAddress,
      transaction.gemsAmount,
      `Deposit confirmed: ${transaction.gemsAmount} gems`
    );
    
    // Update user's totalDeposited
    await UserService.getInstance().recordDeposit(
      transaction.walletAddress,
      transaction.solAmount
    );
    
    await AuditService.getInstance().log({
      walletAddress: transaction.walletAddress,
      action: 'deposit_confirmed',
      description: `Deposit confirmed: +${transaction.gemsAmount} gems`,
      relatedId: transactionId,
      relatedCollection: 'transactions',
      newValue: { txSignature, gemsAmount: transaction.gemsAmount },
    });
    
    return { success: true, transaction };
  }

  /**
   * SECURITY: Calculate how many gems a user can withdraw
   * Users can ONLY withdraw gems they've deposited - NOT initial bonus or winnings from bonus gems
   * This prevents draining the custodial wallet
   */
  async getWithdrawableAmount(walletAddress: string): Promise<{
    withdrawable: number;
    totalDeposited: number;
    totalWithdrawn: number;
    currentBalance: number;
    bonusGems: number;
  }> {
    const user = await UserService.getInstance().getUser(walletAddress);
    if (!user) {
      return { withdrawable: 0, totalDeposited: 0, totalWithdrawn: 0, currentBalance: 0, bonusGems: 0 };
    }
    
    // Get total deposited gems (not SOL!)
    const collection = await this.getCollection();
    const deposits = await collection.aggregate([
      { $match: { walletAddress, type: 'deposit', status: 'confirmed' } },
      { $group: { _id: null, total: { $sum: '$gemsAmount' } } }
    ]).toArray();
    
    const withdrawals = await collection.aggregate([
      { $match: { walletAddress, type: 'withdrawal', status: 'confirmed' } },
      { $group: { _id: null, total: { $sum: '$gemsAmount' } } }
    ]).toArray();
    
    const totalDepositedGems = deposits[0]?.total || 0;
    const totalWithdrawnGems = withdrawals[0]?.total || 0;
    
    // Withdrawable = deposited - already withdrawn (but can't exceed current balance)
    const maxFromDeposits = Math.max(0, totalDepositedGems - totalWithdrawnGems);
    const withdrawable = Math.min(maxFromDeposits, user.gemsBalance);
    
    // Bonus gems = current balance minus withdrawable
    const bonusGems = user.gemsBalance - withdrawable;
    
    return {
      withdrawable,
      totalDeposited: totalDepositedGems,
      totalWithdrawn: totalWithdrawnGems,
      currentBalance: user.gemsBalance,
      bonusGems
    };
  }

  /**
   * Get user's daily withdrawal total (last 24 hours)
   */
  async getDailyWithdrawalTotal(walletAddress: string): Promise<{
    totalSol: number;
    count: number;
    remainingSol: number;
  }> {
    const collection = await this.getCollection();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const dailyWithdrawals = await collection.find({
      walletAddress,
      type: 'withdrawal',
      status: { $in: ['pending', 'confirmed'] }, // Count pending too (they're committed)
      createdAt: { $gte: oneDayAgo }
    }).toArray();
    
    const totalLamports = dailyWithdrawals.reduce((sum, tx) => sum + tx.solAmount, 0);
    const totalSol = totalLamports / 1e9;
    
    return {
      totalSol,
      count: dailyWithdrawals.length,
      remainingSol: Math.max(0, MAX_DAILY_WITHDRAWAL_SOL - totalSol)
    };
  }

  /**
   * Check if user can withdraw (rate limiting + daily limits)
   */
  async canWithdrawNow(walletAddress: string, requestedSolAmount?: number): Promise<{
    canWithdraw: boolean;
    cooldownRemaining?: number;
    dailyLimit?: number;
    dailyUsed?: number;
    dailyRemaining?: number;
    maxSingle?: number;
    reason?: string;
  }> {
    const collection = await this.getCollection();
    
    // Check for recent withdrawals (cooldown)
    const recentWithdrawal = await collection.findOne({
      walletAddress,
      type: 'withdrawal',
      createdAt: { $gte: new Date(Date.now() - WITHDRAWAL_COOLDOWN_MS) }
    });
    
    if (recentWithdrawal) {
      const cooldownRemaining = WITHDRAWAL_COOLDOWN_MS - (Date.now() - recentWithdrawal.createdAt.getTime());
      return {
        canWithdraw: false,
        cooldownRemaining,
        reason: `Please wait ${Math.ceil(cooldownRemaining / 1000)} seconds before requesting another withdrawal`
      };
    }
    
    // Check daily limits
    const dailyStats = await this.getDailyWithdrawalTotal(walletAddress);
    
    if (dailyStats.remainingSol <= 0) {
      return {
        canWithdraw: false,
        dailyLimit: MAX_DAILY_WITHDRAWAL_SOL,
        dailyUsed: dailyStats.totalSol,
        dailyRemaining: 0,
        reason: `Daily withdrawal limit reached (${MAX_DAILY_WITHDRAWAL_SOL} SOL). Resets in 24 hours.`
      };
    }
    
    // Check if requested amount exceeds limits
    if (requestedSolAmount !== undefined) {
      const requestedSol = requestedSolAmount / 1e9;
      
      if (requestedSol > MAX_SINGLE_WITHDRAWAL_SOL) {
        return {
          canWithdraw: false,
          maxSingle: MAX_SINGLE_WITHDRAWAL_SOL,
          reason: `Maximum single withdrawal is ${MAX_SINGLE_WITHDRAWAL_SOL} SOL`
        };
      }
      
      if (requestedSol > dailyStats.remainingSol) {
        return {
          canWithdraw: false,
          dailyLimit: MAX_DAILY_WITHDRAWAL_SOL,
          dailyUsed: dailyStats.totalSol,
          dailyRemaining: dailyStats.remainingSol,
          reason: `Exceeds daily limit. You can withdraw up to ${dailyStats.remainingSol.toFixed(4)} SOL today.`
        };
      }
    }
    
    return { 
      canWithdraw: true,
      dailyLimit: MAX_DAILY_WITHDRAWAL_SOL,
      dailyUsed: dailyStats.totalSol,
      dailyRemaining: dailyStats.remainingSol,
      maxSingle: MAX_SINGLE_WITHDRAWAL_SOL
    };
  }

  /**
   * Create a withdrawal request
   * Validates that destinationAddress matches the authenticated user's wallet
   * SECURITY: Only allows withdrawal of deposited gems (not bonus/winnings from bonus)
   */
  async createWithdrawal(
    walletAddress: string,
    gemsAmount: number,
    destinationAddress: string
  ): Promise<{ success: boolean; error?: string; transaction?: Transaction; solAmount?: number; feeAmount?: number; netGems?: number }> {
    // SECURITY: Ensure destination matches authenticated wallet
    if (destinationAddress !== walletAddress) {
      await AuditService.getInstance().log({
        walletAddress,
        action: 'withdrawal_initiated',
        description: `BLOCKED: Withdrawal destination mismatch. Requested: ${destinationAddress.slice(0, 8)}...`,
      });
      
      logger.warn('[Transaction] Destination mismatch blocked', {
        wallet: walletAddress.slice(0, 8)
      });
      
      return { 
        success: false, 
        error: 'Withdrawal destination must match your authenticated wallet' 
      };
    }
    
    const minWithdrawal = getMinWithdrawal();
    
    // Validate minimum
    if (gemsAmount < minWithdrawal) {
      return { 
        success: false, 
        error: `Minimum withdrawal is ${minWithdrawal} gems` 
      };
    }
    
    // Check user balance
    const user = await UserService.getInstance().getUser(walletAddress);
    if (!user || user.gemsBalance < gemsAmount) {
      return { success: false, error: 'Insufficient balance' };
    }
    
    // Check user status
    if (user.status !== 'active') {
      return { success: false, error: 'Account is suspended' };
    }
    
    // Calculate SOL amount first (needed for limit checks)
    const withdrawalFee = getWithdrawalFee();
    const feeAmount = Math.floor(gemsAmount * withdrawalFee);
    const netGems = gemsAmount - feeAmount;
    const solAmount = Math.floor((netGems / getGemsPerSol()) * 1e9); // in lamports
    
    // SECURITY: Rate limiting + daily limits
    const rateCheck = await this.canWithdrawNow(walletAddress, solAmount);
    if (!rateCheck.canWithdraw) {
      return { success: false, error: rateCheck.reason };
    }
    
    // SECURITY: Check withdrawable amount (deposited only - no bonus gems)
    const withdrawableInfo = await this.getWithdrawableAmount(walletAddress);
    if (gemsAmount > withdrawableInfo.withdrawable) {
      const bonusMsg = withdrawableInfo.bonusGems > 0 
        ? ` (${withdrawableInfo.bonusGems} gems from bonus/winnings cannot be withdrawn)` 
        : '';
        
      logger.warn('[Transaction] Withdrawal exceeds deposited amount', {
        wallet: walletAddress.slice(0, 8),
        requested: gemsAmount,
        withdrawable: withdrawableInfo.withdrawable,
        bonus: withdrawableInfo.bonusGems
      });
      
      await AuditService.getInstance().log({
        walletAddress,
        action: 'withdrawal_initiated',
        description: `BLOCKED: Cannot withdraw ${gemsAmount} gems. Only ${withdrawableInfo.withdrawable} withdrawable.${bonusMsg}`,
      });
      
      return { 
        success: false, 
        error: `You can only withdraw gems you've deposited. Maximum withdrawable: ${withdrawableInfo.withdrawable} gems${bonusMsg}`
      };
    }
    
    // Note: feeAmount, netGems, solAmount already calculated above for limit checks
    
    const collection = await this.getCollection();
    
    // SECURITY: First check if there's already a pending withdrawal in transactions collection
    const existingPending = await collection.findOne({
      walletAddress,
      type: 'withdrawal',
      status: 'pending'
    });
    
    if (existingPending) {
      logger.warn('[Transaction] Duplicate withdrawal blocked (pre-check)', {
        wallet: walletAddress.slice(0, 8),
        existingId: existingPending._id?.toString()
      });
      return { 
        success: false, 
        error: 'You already have a pending withdrawal. Please wait for it to complete.' 
      };
    }
    
    const transaction: Transaction = {
      walletAddress,
      type: 'withdrawal',
      status: 'pending',
      solAmount,
      gemsAmount,
      feeAmount,
      destinationAddress, // User's wallet (validated above)
      createdAt: new Date(),
    };
    
    // SECURITY: Try to insert - will fail if duplicate due to unique partial index
    // This is the final safety net if race condition bypasses the check above
    try {
      const result = await collection.insertOne(transaction);
      transaction._id = result.insertedId;
    } catch (err: unknown) {
      // Check if it's a duplicate key error (code 11000)
      const mongoError = err as { code?: number };
      if (mongoError.code === 11000) {
        logger.warn('[Transaction] Duplicate withdrawal blocked by index', {
          wallet: walletAddress.slice(0, 8)
        });
        return { 
          success: false, 
          error: 'You already have a pending withdrawal. Please wait for it to complete.' 
        };
      }
      throw err; // Re-throw other errors
    }
    
    // Deduct from user balance immediately (prevents double-spend)
    await UserService.getInstance().updateBalance(
      walletAddress,
      -gemsAmount,
      `Withdrawal requested: ${gemsAmount} gems`
    );
    
    await AuditService.getInstance().log({
      walletAddress,
      action: 'withdrawal_initiated',
      description: `Withdrawal initiated: ${gemsAmount} gems (${feeAmount} fee) = ${solAmount / 1e9} SOL`,
      relatedId: transaction._id!.toString(),
      relatedCollection: 'transactions',
      newValue: { gemsAmount, feeAmount, solAmount, destinationAddress: destinationAddress.slice(0, 8) },
    });
    
    return { success: true, transaction, solAmount, feeAmount, netGems };
  }

  /**
   * Confirm a withdrawal after sending SOL
   */
  async confirmWithdrawal(
    transactionId: string,
    txSignature: string
  ): Promise<boolean> {
    const collection = await this.getCollection();
    
    const result = await collection.updateOne(
      { _id: new ObjectId(transactionId), status: 'pending', type: 'withdrawal' },
      {
        $set: {
          status: 'confirmed' as TransactionStatus,
          txSignature,
          confirmedAt: new Date()
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      const transaction = await collection.findOne({ _id: new ObjectId(transactionId) });
      
      // Update user's totalWithdrawn
      if (transaction) {
        await UserService.getInstance().recordWithdrawal(
          transaction.walletAddress,
          transaction.solAmount
        );
      }
      
      await AuditService.getInstance().log({
        walletAddress: transaction?.walletAddress,
        action: 'withdrawal_confirmed',
        description: `Withdrawal confirmed: ${transaction?.solAmount ? transaction.solAmount / 1e9 : 0} SOL sent`,
        relatedId: transactionId,
        relatedCollection: 'transactions',
        newValue: { txSignature: txSignature.slice(0, 16) },
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Confirm a withdrawal by wallet address (used by queue processor)
   * Finds the pending withdrawal for this wallet and confirms it
   */
  async confirmWithdrawalByWallet(
    walletAddress: string,
    txSignature: string
  ): Promise<boolean> {
    const collection = await this.getCollection();
    
    // Find pending withdrawal for this wallet
    const transaction = await collection.findOne({
      walletAddress,
      type: 'withdrawal',
      status: 'pending'
    });
    
    if (!transaction || !transaction._id) {
      return false;
    }
    
    // Use the existing confirmWithdrawal method
    return this.confirmWithdrawal(transaction._id.toString(), txSignature);
  }

  /**
   * Cancel a pending withdrawal by wallet address
   * Used when user cancels from the queue
   */
  async cancelPendingWithdrawalByWallet(walletAddress: string): Promise<boolean> {
    const collection = await this.getCollection();
    
    const result = await collection.updateOne(
      {
        walletAddress,
        type: 'withdrawal',
        status: 'pending'
      },
      {
        $set: {
          status: 'cancelled' as TransactionStatus,
          cancelledAt: new Date()
        }
      }
    );
    
    return result.modifiedCount > 0;
  }

  /**
   * Cancel a pending withdrawal (refund gems)
   */
  async cancelWithdrawal(
    transactionId: string,
    reason: string
  ): Promise<boolean> {
    const collection = await this.getCollection();
    
    const transaction = await collection.findOne({ 
      _id: new ObjectId(transactionId),
      status: 'pending',
      type: 'withdrawal'
    });
    
    if (!transaction) return false;
    
    await collection.updateOne(
      { _id: new ObjectId(transactionId) },
      {
        $set: {
          status: 'cancelled' as TransactionStatus,
          notes: reason
        }
      }
    );
    
    // Refund user
    await UserService.getInstance().updateBalance(
      transaction.walletAddress,
      transaction.gemsAmount,
      `Withdrawal cancelled: +${transaction.gemsAmount} gems refunded`
    );
    
    await AuditService.getInstance().log({
      walletAddress: transaction.walletAddress,
      action: 'withdrawal_initiated',
      description: `Withdrawal cancelled: ${reason}`,
      relatedId: transactionId,
      relatedCollection: 'transactions',
    });
    
    return true;
  }

  /**
   * Get transaction history for a user
   */
  async getUserTransactions(
    walletAddress: string,
    options?: { 
      type?: TransactionType; 
      status?: TransactionStatus;
      limit?: number; 
      skip?: number 
    }
  ): Promise<Transaction[]> {
    const collection = await this.getCollection();
    
    const query: Record<string, unknown> = { walletAddress };
    if (options?.type) query.type = options.type;
    if (options?.status) query.status = options.status;
    
    return collection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(options?.skip || 0)
      .limit(options?.limit || 50)
      .toArray();
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(transactionId: string): Promise<Transaction | null> {
    const collection = await this.getCollection();
    return collection.findOne({ _id: new ObjectId(transactionId) });
  }

  /**
   * Get all transactions (admin use - development only)
   */
  async getAllTransactions(options?: {
    limit?: number;
    skip?: number;
    type?: TransactionType;
    status?: TransactionStatus;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Transaction[]> {
    const collection = await this.getCollection();
    
    const query: Record<string, unknown> = {};
    if (options?.type) query.type = options.type;
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
   * Get transaction statistics (admin use)
   */
  async getTransactionStats(): Promise<{
    totalDeposits: number;
    totalWithdrawals: number;
    totalDepositSol: number;
    totalWithdrawalSol: number;
    pendingWithdrawals: number;
    pendingWithdrawalSol: number;
  }> {
    const collection = await this.getCollection();
    
    const pipeline = [
      {
        $facet: {
          deposits: [
            { $match: { type: 'deposit', status: 'confirmed' } },
            { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$solAmount' } } }
          ],
          withdrawals: [
            { $match: { type: 'withdrawal', status: 'confirmed' } },
            { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$solAmount' } } }
          ],
          pendingWithdrawals: [
            { $match: { type: 'withdrawal', status: 'pending' } },
            { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$solAmount' } } }
          ]
        }
      }
    ];
    
    interface StatsResult {
      deposits: Array<{ count: number; total: number }>;
      withdrawals: Array<{ count: number; total: number }>;
      pendingWithdrawals: Array<{ count: number; total: number }>;
    }
    
    const result = await collection.aggregate<StatsResult>(pipeline).toArray();
    
    // Defensive: handle empty database or missing facet results
    const stats = result[0] || { deposits: [], withdrawals: [], pendingWithdrawals: [] };
    
    return {
      totalDeposits: stats.deposits?.[0]?.count ?? 0,
      totalWithdrawals: stats.withdrawals?.[0]?.count ?? 0,
      totalDepositSol: stats.deposits?.[0]?.total ?? 0,
      totalWithdrawalSol: stats.withdrawals?.[0]?.total ?? 0,
      pendingWithdrawals: stats.pendingWithdrawals?.[0]?.count ?? 0,
      pendingWithdrawalSol: stats.pendingWithdrawals?.[0]?.total ?? 0,
    };
  }
}
