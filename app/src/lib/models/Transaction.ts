import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type TransactionType = 'deposit' | 'withdrawal' | 'bet' | 'win' | 'refund';
export type TransactionStatus = 'pending' | 'completed' | 'failed';

export interface ITransaction extends Document {
  user: Types.ObjectId;
  walletAddress: string;
  type: TransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  status: TransactionStatus;
  
  // For deposits/withdrawals
  solAmount?: number; // Amount in SOL
  txHash?: string; // Solana transaction signature
  
  // For bets
  betId?: Types.ObjectId;
  
  // Metadata
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    walletAddress: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['deposit', 'withdrawal', 'bet', 'win', 'refund'],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'completed',
    },
    
    // Crypto fields
    solAmount: {
      type: Number,
    },
    txHash: {
      type: String,
      sparse: true,
      index: true,
    },
    
    // Bet reference
    betId: {
      type: Schema.Types.ObjectId,
      ref: 'Bet',
    },
    
    description: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for transaction history queries
TransactionSchema.index({ walletAddress: 1, createdAt: -1 });

export const Transaction: Model<ITransaction> =
  mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);

