import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type BetStatus = 'pending' | 'won' | 'lost' | 'cancelled';

export interface IBet extends Document {
  oddsId: string;
  oddsSignature: string;
  user: Types.ObjectId;
  walletAddress: string;
  amount: number;
  multiplier: number;
  potentialPayout: number;
  
  // Grid position of the bet
  columnX: number; // World X coordinate of the column
  cellYIndex: number; // Y grid index
  
  // Price targets for resolution
  priceAtBet: number; // SOL price when bet was placed
  targetPriceMin: number; // Min price to hit cell
  targetPriceMax: number; // Max price to hit cell
  resolveAtWorldX: number; // World X coordinate where bet resolves
  
  // Outcome
  status: BetStatus;
  resolvedAt?: Date;
  resolvedPrice?: number;
  payout: number;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

const BetSchema = new Schema<IBet>(
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
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    multiplier: {
      type: Number,
      required: true,
      min: 1.01,
    },
    potentialPayout: {
      type: Number,
      required: true,
    },
    
    // Grid position
    columnX: {
      type: Number,
      required: true,
    },
    cellYIndex: {
      type: Number,
      required: true,
    },
    
    // Price resolution
    priceAtBet: {
      type: Number,
      required: true,
    },
    targetPriceMin: {
      type: Number,
      required: true,
    },
    targetPriceMax: {
      type: Number,
      required: true,
    },
    resolveAtWorldX: {
      type: Number,
      required: true,
      index: true,
    },
    
    // Outcome
    status: {
      type: String,
      enum: ['pending', 'won', 'lost', 'cancelled'],
      default: 'pending',
      index: true,
    },
    resolvedAt: {
      type: Date,
    },
    resolvedPrice: {
      type: Number,
    },
    payout: {
      type: Number,
      default: 0,
    },
    oddsId: {
      type: String,
      required: true,
    },
    oddsSignature: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries
BetSchema.index({ status: 1, resolveAtWorldX: 1 });
BetSchema.index({ walletAddress: 1, status: 1 });

export const Bet: Model<IBet> =
  mongoose.models.Bet || mongoose.model<IBet>('Bet', BetSchema);

