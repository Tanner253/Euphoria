/**
 * Database Model Types for Euphoria
 * Defines the structure of all database documents
 */

import { ObjectId } from 'mongodb';

// ==============================================
// USER
// ==============================================

export interface User {
  _id?: ObjectId;
  walletAddress: string;          // Solana wallet address (primary identifier)
  
  // Balance
  gemsBalance: number;            // Current gems balance
  totalDeposited: number;         // Total SOL deposited (in lamports)
  totalWithdrawn: number;         // Total SOL withdrawn (in lamports)
  
  // Stats
  totalBets: number;              // Total number of bets placed
  totalWins: number;              // Total number of winning bets
  totalLosses: number;            // Total number of losing bets
  totalWagered: number;           // Total gems wagered
  totalWon: number;               // Total gems won
  totalLost: number;              // Total gems lost
  biggestWin: number;             // Biggest single win
  
  // Timestamps
  createdAt: Date;                // Account creation date
  lastActiveAt: Date;             // Last activity timestamp
  lastAuthAt?: Date;              // Last x403 authentication
  
  // Status
  status: 'active' | 'suspended' | 'banned';
  suspensionReason?: string;
  
  // Metadata
  firstIpAddress?: string;        // For audit purposes
  userAgent?: string;             // Browser info
}

// ==============================================
// TRANSACTION (Deposits & Withdrawals)
// ==============================================

export type TransactionType = 'deposit' | 'withdrawal' | 'bonus' | 'adjustment';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled';

export interface Transaction {
  _id?: ObjectId;
  walletAddress: string;
  
  type: TransactionType;
  status: TransactionStatus;
  
  // Amounts
  solAmount: number;              // SOL amount (in lamports)
  gemsAmount: number;             // Gems credited/debited
  feeAmount?: number;             // Platform fee (for withdrawals)
  
  // Blockchain data
  txSignature?: string;           // Solana transaction signature
  blockTime?: number;             // Block timestamp
  slot?: number;                  // Solana slot
  
  // For withdrawals
  destinationAddress?: string;    // Where funds were sent
  
  // Timestamps
  createdAt: Date;
  confirmedAt?: Date;
  
  // Metadata
  notes?: string;                 // Admin notes
  processedBy?: string;           // For manual adjustments
}

// ==============================================
// BET
// ==============================================

export type BetStatus = 'pending' | 'won' | 'lost' | 'cancelled' | 'expired';

export interface Bet {
  _id?: ObjectId;
  walletAddress: string;
  sessionId: string;              // Game session ID
  
  // Bet details
  amount: number;                 // Gems wagered
  multiplier: number;             // Multiplier at time of bet
  potentialWin: number;           // amount * multiplier
  
  // Grid position (SIMPLE GRID-BASED SYSTEM)
  columnId: string;               // Column where bet was placed
  yIndex: number;                 // Cell Y index (THE WIN CELL)
  basePrice: number;              // Client's basePrice anchor for grid
  cellSize: number;               // Cell size at bet time
  priceAtBet: number;             // SOL price when bet was placed
  
  // GRID-ALIGNED WIN BOUNDARIES
  // Calculated from yIndex + basePrice + cellSize
  // Price in [winPriceMin, winPriceMax) = cell at yIndex
  winPriceMin?: number;           // Price must be >= this to win
  winPriceMax?: number;           // Price must be < this to win
  
  // Resolution
  status: BetStatus;
  priceAtResolution?: number;     // SOL price when resolved
  actualWin?: number;             // Actual winnings (0 if lost)
  
  // Timestamps
  createdAt: Date;
  resolvedAt?: Date;
  
  // Verification
  clientHash?: string;            // Client-side verification hash
  serverHash?: string;            // Server-side verification hash
}

// ==============================================
// SESSION
// ==============================================

export interface Session {
  _id?: ObjectId;
  walletAddress: string;
  
  // Auth data
  authPayload: string;            // x403 encoded payload
  signature: string;              // Wallet signature
  
  // JWT
  jwtToken?: string;              // Server-issued JWT (hashed)
  
  // Stats for this session
  betsPlaced: number;
  gemsWon: number;
  gemsLost: number;
  
  // Timestamps
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  
  // Device info
  ipAddress?: string;
  userAgent?: string;
}

// ==============================================
// AUDIT LOG
// ==============================================

export type AuditAction = 
  | 'user_created'
  | 'user_authenticated'
  | 'user_disconnected'
  | 'deposit_initiated'
  | 'deposit_confirmed'
  | 'withdrawal_initiated'
  | 'withdrawal_confirmed'
  | 'bet_placed'
  | 'bet_resolved'
  | 'balance_adjusted'
  | 'user_suspended'
  | 'user_banned'
  | 'admin_action';

export interface AuditLog {
  _id?: ObjectId;
  walletAddress?: string;         // May be null for system events
  
  action: AuditAction;
  description: string;
  
  // Related data
  relatedId?: string;             // ID of related document (bet, transaction, etc.)
  relatedCollection?: string;     // Collection name
  
  // Before/after for changes
  previousValue?: unknown;
  newValue?: unknown;
  
  // Context
  ipAddress?: string;
  userAgent?: string;
  
  // Timestamps
  createdAt: Date;
  
  // Admin actions
  performedBy?: string;           // Admin wallet address
}

// ==============================================
// AGGREGATED STATS (for dashboards)
// ==============================================

export interface UserStats {
  walletAddress: string;
  gemsBalance: number;
  totalBets: number;
  winRate: number;                // percentage
  totalWagered: number;
  netProfit: number;              // totalWon - totalLost
  biggestWin: number;
}

export interface GlobalStats {
  totalUsers: number;
  activeUsers24h: number;
  totalBetsAllTime: number;
  totalVolumeAllTime: number;     // Total gems wagered
  houseEdgeRealized: number;      // Actual house profit
}

