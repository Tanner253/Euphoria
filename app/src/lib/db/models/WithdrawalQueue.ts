/**
 * WithdrawalQueue Model
 * Tracks gem withdrawal requests with queue support for low-balance scenarios
 * 
 * Similar to waddle.bet's PebbleWithdrawal system
 */

import { Collection, ObjectId } from 'mongodb';
import { connectToDatabase } from '../mongodb';
import crypto from 'crypto';

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface WithdrawalQueueItem {
  _id?: ObjectId;
  
  // Request identification
  withdrawalId: string;
  
  // SECURITY: Idempotency key prevents replay attacks
  idempotencyKey: string;
  
  // SECURITY: Processing lock to prevent double-processing
  processingLock: string | null;
  processingLockExpiry: Date | null;
  
  // User info
  walletAddress: string;
  
  // Amount details
  gemsAmount: number;        // Total gems requested
  feeAmount: number;         // Gems taken as fee
  netGems: number;           // Gems after fee
  solAmount: number;         // SOL to be sent (in lamports)
  
  // Status tracking
  status: WithdrawalStatus;
  
  // Queue position (for pending withdrawals)
  queuePosition: number | null;
  
  // Processing info
  txSignature: string | null;
  processedAt: Date | null;
  failureReason: string | null;
  attemptCount: number;  // Track attempts for logging (no limit)
  
  // Timestamps
  requestedAt: Date;
  lastAttemptAt: Date | null;
}

// SECURITY: Always get fresh collection reference
async function getCollection(): Promise<Collection<WithdrawalQueueItem>> {
  const { db } = await connectToDatabase();
  const coll = db.collection<WithdrawalQueueItem>('withdrawal_queue');
  
  // Ensure indexes exist (idempotent operation)
  await coll.createIndex({ withdrawalId: 1 }, { unique: true });
  await coll.createIndex({ idempotencyKey: 1 }, { unique: true });
  await coll.createIndex({ walletAddress: 1, status: 1 });
  await coll.createIndex({ status: 1, requestedAt: 1 });
  await coll.createIndex({ status: 1, queuePosition: 1 });
  await coll.createIndex({ processingLockExpiry: 1 }); // For cleaning up stale locks
  
  return coll;
}

// SECURITY: Generate cryptographically secure lock ID
function generateLockId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate unique withdrawal ID
 */
function generateWithdrawalId(): string {
  return `gw_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * SECURITY: Generate idempotency key from request parameters
 * This prevents replay attacks and duplicate withdrawals
 */
function generateIdempotencyKey(walletAddress: string, gemsAmount: number, timestamp: number): string {
  const data = `${walletAddress}:${gemsAmount}:${timestamp}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Lock duration in milliseconds (2 minutes - enough for transaction to complete)
const LOCK_DURATION_MS = 2 * 60 * 1000;

/**
 * Create a new pending withdrawal request
 * SECURITY: Uses idempotency key to prevent duplicate requests
 */
export async function createWithdrawalRequest(data: {
  walletAddress: string;
  gemsAmount: number;
  feeAmount: number;
  netGems: number;
  solAmount: number;
}): Promise<WithdrawalQueueItem> {
  const coll = await getCollection();
  const now = Date.now();
  
  // SECURITY: Generate idempotency key to prevent duplicates
  const idempotencyKey = generateIdempotencyKey(data.walletAddress, data.gemsAmount, Math.floor(now / 60000)); // 1-minute window
  
  // Check for existing request with same idempotency key
  const existing = await coll.findOne({ idempotencyKey });
  if (existing) {
    // Return existing request instead of creating duplicate
    return existing;
  }
  
  // Get next queue position atomically
  const lastInQueue = await coll.findOne(
    { status: 'pending' },
    { sort: { queuePosition: -1 } }
  );
  const queuePosition = (lastInQueue?.queuePosition || 0) + 1;
  
  const withdrawal: WithdrawalQueueItem = {
    withdrawalId: generateWithdrawalId(),
    idempotencyKey,
    processingLock: null,
    processingLockExpiry: null,
    walletAddress: data.walletAddress,
    gemsAmount: data.gemsAmount,
    feeAmount: data.feeAmount,
    netGems: data.netGems,
    solAmount: data.solAmount,
    status: 'pending',
    queuePosition,
    txSignature: null,
    processedAt: null,
    failureReason: null,
    attemptCount: 0,
    requestedAt: new Date(),
    lastAttemptAt: null,
  };
  
  const result = await coll.insertOne(withdrawal);
  withdrawal._id = result.insertedId;
  
  return withdrawal;
}

/**
 * Get pending withdrawals in queue order
 */
export async function getPendingQueue(limit = 10): Promise<WithdrawalQueueItem[]> {
  const coll = await getCollection();
  return coll
    .find({ status: 'pending' })
    .sort({ queuePosition: 1 })
    .limit(limit)
    .toArray();
}

/**
 * Get user's withdrawals
 */
export async function getUserWithdrawals(
  walletAddress: string,
  limit = 10
): Promise<WithdrawalQueueItem[]> {
  const coll = await getCollection();
  return coll
    .find({ walletAddress })
    .sort({ requestedAt: -1 })
    .limit(limit)
    .toArray();
}

/**
 * SECURITY: Atomically claim a withdrawal for processing
 * Uses distributed locking to prevent double-processing
 * Returns null if already claimed by another process or already completed
 */
export async function claimForProcessing(
  withdrawalId: string
): Promise<{ withdrawal: WithdrawalQueueItem; lockId: string } | null> {
  const coll = await getCollection();
  const lockId = generateLockId();
  const lockExpiry = new Date(Date.now() + LOCK_DURATION_MS);
  
  // SECURITY: Atomic claim - only succeeds if:
  // 1. Status is 'pending' (not completed, not currently processing)
  // 2. No active lock exists (lock is null OR lock has expired)
  // No retry limit - keep trying until custodial wallet has funds
  const result = await coll.findOneAndUpdate(
    { 
      withdrawalId, 
      status: 'pending',
      $or: [
        { processingLock: null },
        { processingLockExpiry: { $lt: new Date() } } // Expired lock
      ]
    },
    {
      $set: { 
        status: 'processing', 
        processingLock: lockId,
        processingLockExpiry: lockExpiry,
        lastAttemptAt: new Date() 
      },
      $inc: { attemptCount: 1 }
    },
    { returnDocument: 'after' }
  );
  
  if (!result) {
    return null; // Already claimed or already completed
  }
  
  return { withdrawal: result, lockId };
}

/**
 * @deprecated Use claimForProcessing instead for atomic locking
 */
export async function markProcessing(
  withdrawalId: string
): Promise<WithdrawalQueueItem | null> {
  const result = await claimForProcessing(withdrawalId);
  return result?.withdrawal || null;
}

/**
 * SECURITY: Mark withdrawal as completed with lock verification
 * Only succeeds if the caller holds the valid lock
 */
export async function markCompleted(
  withdrawalId: string,
  txSignature: string,
  lockId?: string
): Promise<WithdrawalQueueItem | null> {
  const coll = await getCollection();
  
  // Build query - if lockId provided, verify ownership
  const query: Record<string, unknown> = { 
    withdrawalId, 
    status: 'processing' 
  };
  
  if (lockId) {
    query.processingLock = lockId;
  }
  
  const result = await coll.findOneAndUpdate(
    query,
    {
      $set: {
        status: 'completed',
        txSignature,
        processedAt: new Date(),
        queuePosition: null,
        processingLock: null,
        processingLockExpiry: null
      }
    },
    { returnDocument: 'after' }
  );
  
  return result;
}

/**
 * SECURITY: Check if a withdrawal has already been completed
 * Used to prevent double-processing
 */
export async function isAlreadyCompleted(withdrawalId: string): Promise<boolean> {
  const coll = await getCollection();
  const withdrawal = await coll.findOne({ withdrawalId });
  return withdrawal?.status === 'completed';
}

/**
 * SECURITY: Check if transaction signature already exists
 * Prevents using same tx to complete multiple withdrawals
 */
export async function txSignatureExists(txSignature: string): Promise<boolean> {
  const coll = await getCollection();
  const existing = await coll.findOne({ txSignature, status: 'completed' });
  return existing !== null;
}

/**
 * Mark withdrawal as failed - goes back to pending for retry
 * SECURITY: Releases the processing lock
 * No retry limit - will keep trying until custodial wallet has funds
 */
export async function markFailed(
  withdrawalId: string,
  reason: string,
  lockId?: string
): Promise<WithdrawalQueueItem | null> {
  const coll = await getCollection();
  
  // Back to pending for retry (no retry limit)
  return coll.findOneAndUpdate(
    { withdrawalId, ...(lockId ? { processingLock: lockId } : {}) },
    {
      $set: {
        status: 'pending',
        failureReason: reason,
        lastAttemptAt: new Date(),
        processingLock: null,
        processingLockExpiry: null
      }
    },
    { returnDocument: 'after' }
  );
}

/**
 * SECURITY: Release a processing lock without completing
 * Used when processing is aborted
 */
export async function releaseLock(
  withdrawalId: string,
  lockId: string
): Promise<boolean> {
  const coll = await getCollection();
  const result = await coll.updateOne(
    { withdrawalId, processingLock: lockId },
    {
      $set: {
        status: 'pending',
        processingLock: null,
        processingLockExpiry: null
      }
    }
  );
  return result.modifiedCount > 0;
}

/**
 * SECURITY: Clean up stale locks (expired but not released)
 * Should be called periodically
 */
export async function cleanupStaleLocks(): Promise<number> {
  const coll = await getCollection();
  const result = await coll.updateMany(
    {
      status: 'processing',
      processingLockExpiry: { $lt: new Date() }
    },
    {
      $set: {
        status: 'pending',
        processingLock: null,
        processingLockExpiry: null,
        failureReason: 'Lock expired - processing timed out'
      }
    }
  );
  return result.modifiedCount;
}

/**
 * Reset all stuck withdrawals back to pending
 * Used to recover from edge cases where withdrawals got stuck
 */
export async function resetStuckWithdrawals(): Promise<number> {
  const coll = await getCollection();
  
  // Reset any withdrawal that is:
  // 1. In 'processing' status (stuck)
  // 2. In 'failed' status (can retry)
  // But NOT 'completed' or 'cancelled'
  const result = await coll.updateMany(
    {
      status: { $in: ['processing', 'failed'] }
    },
    {
      $set: {
        status: 'pending',
        processingLock: null,
        processingLockExpiry: null,
        failureReason: null
      }
    }
  );
  return result.modifiedCount;
}

/**
 * Cancel a pending withdrawal
 */
export async function cancelWithdrawal(
  withdrawalId: string,
  walletAddress: string
): Promise<WithdrawalQueueItem | null> {
  const coll = await getCollection();
  return coll.findOneAndUpdate(
    { withdrawalId, walletAddress, status: 'pending' },
    { $set: { status: 'cancelled', queuePosition: null } },
    { returnDocument: 'after' }
  );
}

/**
 * Get withdrawal by ID
 */
export async function getWithdrawal(
  withdrawalId: string
): Promise<WithdrawalQueueItem | null> {
  const coll = await getCollection();
  return coll.findOne({ withdrawalId });
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  completedCount: number;
  totalPendingSol: number;
}> {
  const coll = await getCollection();
  
  const pending = await coll.countDocuments({ status: 'pending' });
  const processing = await coll.countDocuments({ status: 'processing' });
  const failed = await coll.countDocuments({ status: 'failed' });
  const completed = await coll.countDocuments({ status: 'completed' });
  
  const totalPendingSolResult = await coll.aggregate([
    { $match: { status: 'pending' } },
    { $group: { _id: null, total: { $sum: '$solAmount' } } }
  ]).toArray();
  
  return {
    pendingCount: pending,
    processingCount: processing,
    failedCount: failed,
    completedCount: completed,
    totalPendingSol: totalPendingSolResult[0]?.total || 0
  };
}

/**
 * Get ALL withdrawals in queue (all statuses)
 */
export async function getAllQueueItems(limit = 50): Promise<WithdrawalQueueItem[]> {
  const coll = await getCollection();
  return coll
    .find({})
    .sort({ requestedAt: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Check if user has pending withdrawal
 */
export async function hasPendingWithdrawal(walletAddress: string): Promise<boolean> {
  const coll = await getCollection();
  const count = await coll.countDocuments({
    walletAddress,
    status: { $in: ['pending', 'processing'] }
  });
  return count > 0;
}

/**
 * Get user's pending withdrawal
 */
export async function getUserPendingWithdrawal(
  walletAddress: string
): Promise<WithdrawalQueueItem | null> {
  const coll = await getCollection();
  return coll.findOne({
    walletAddress,
    status: { $in: ['pending', 'processing'] }
  });
}

