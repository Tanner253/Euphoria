/**
 * AuditService - Handles audit logging for all system actions
 * Critical for compliance and debugging
 */

import { Collection } from 'mongodb';
import { connectToDatabase } from '../mongodb';
import { AuditLog, AuditAction } from '../models/types';

interface LogParams {
  walletAddress?: string;
  action: AuditAction;
  description: string;
  relatedId?: string;
  relatedCollection?: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
  performedBy?: string;
}

export class AuditService {
  private static instance: AuditService | null = null;

  private constructor() {}

  static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  // Always get fresh collection to handle reconnections
  private async getCollection(): Promise<Collection<AuditLog>> {
    const { db } = await connectToDatabase();
    return db.collection<AuditLog>('auditLog');
  }

  /**
   * Log an action to the audit trail
   */
  async log(params: LogParams): Promise<void> {
    try {
      const collection = await this.getCollection();
      
      const logEntry: AuditLog = {
        walletAddress: params.walletAddress,
        action: params.action,
        description: params.description,
        relatedId: params.relatedId,
        relatedCollection: params.relatedCollection,
        previousValue: params.previousValue,
        newValue: params.newValue,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        performedBy: params.performedBy,
        createdAt: new Date(),
      };
      
      await collection.insertOne(logEntry);
    } catch {
      // Don't throw - audit logging should never break main operations
      // Don't log errors here as it could create an infinite loop or expose data
    }
  }

  /**
   * Get audit logs for a specific wallet
   */
  async getLogsForWallet(
    walletAddress: string,
    options?: { limit?: number; skip?: number; action?: AuditAction }
  ): Promise<AuditLog[]> {
    const collection = await this.getCollection();
    
    const query: Record<string, unknown> = { walletAddress };
    if (options?.action) {
      query.action = options.action;
    }
    
    return collection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(options?.skip || 0)
      .limit(options?.limit || 100)
      .toArray();
  }

  /**
   * Get all logs for a time period
   */
  async getLogsByTimeRange(
    startDate: Date,
    endDate: Date,
    options?: { action?: AuditAction; limit?: number }
  ): Promise<AuditLog[]> {
    const collection = await this.getCollection();
    
    const query: Record<string, unknown> = {
      createdAt: { $gte: startDate, $lte: endDate }
    };
    
    if (options?.action) {
      query.action = options.action;
    }
    
    return collection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(options?.limit || 1000)
      .toArray();
  }

  /**
   * Get logs related to a specific document
   */
  async getLogsForDocument(
    relatedId: string,
    relatedCollection: string
  ): Promise<AuditLog[]> {
    const collection = await this.getCollection();
    
    return collection
      .find({ relatedId, relatedCollection })
      .sort({ createdAt: -1 })
      .toArray();
  }

  /**
   * Get summary of actions by type
   */
  async getActionSummary(
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{ action: AuditAction; count: number }>> {
    const collection = await this.getCollection();
    
    const match: Record<string, unknown> = {};
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) (match.createdAt as Record<string, Date>).$gte = startDate;
      if (endDate) (match.createdAt as Record<string, Date>).$lte = endDate;
    }
    
    const pipeline = [
      ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          action: '$_id',
          count: 1,
          _id: 0
        }
      },
      { $sort: { count: -1 as const } }
    ];
    
    return collection.aggregate<{ action: AuditAction; count: number }>(pipeline).toArray();
  }
}

