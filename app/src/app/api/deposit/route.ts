import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { User, Transaction } from '@/lib/models';
import { GAME_CONFIG } from '@/lib/game/config';

/**
 * POST /api/deposit
 * Simulate a SOL deposit (in production, verify actual Solana transaction)
 * 
 * For demo: Just credit the account
 * For production: Verify txHash against Solana RPC
 */
export async function POST(request: NextRequest) {
  try {
    const { walletAddress, solAmount, txHash } = await request.json();
    
    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json(
        { error: 'Invalid wallet address' },
        { status: 400 }
      );
    }
    
    if (!solAmount || typeof solAmount !== 'number' || solAmount <= 0) {
      return NextResponse.json(
        { error: 'Invalid deposit amount' },
        { status: 400 }
      );
    }
    
    const normalizedAddress = walletAddress.toLowerCase().trim();
    
    await connectToDatabase();
    
    // Find user
    const user = await User.findOne({ walletAddress: normalizedAddress });
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found. Connect wallet first.' },
        { status: 404 }
      );
    }
    
    // TODO: In production, verify the Solana transaction here
    // const isValid = await verifySolanaTransaction(txHash, walletAddress, solAmount, CUSTODIAL_WALLET);
    // if (!isValid) return error
    
    // For demo/simulated mode: Check if txHash already used
    if (txHash) {
      const existingTx = await Transaction.findOne({ txHash });
      if (existingTx) {
        return NextResponse.json(
          { error: 'Transaction already processed' },
          { status: 400 }
        );
      }
    }
    
    // Convert SOL to gems
    const gemsAmount = solAmount * GAME_CONFIG.SOL_TO_GEMS_RATE;
    
    const balanceBefore = user.balance;
    const balanceAfter = balanceBefore + gemsAmount;
    
    // Update user balance
    user.balance = balanceAfter;
    user.totalDeposited += gemsAmount;
    await user.save();
    
    // Create transaction record
    await Transaction.create({
      user: user._id,
      walletAddress: normalizedAddress,
      type: 'deposit',
      amount: gemsAmount,
      balanceBefore,
      balanceAfter,
      status: 'completed',
      solAmount,
      txHash: txHash || `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      description: `Deposited ${solAmount} SOL → ${gemsAmount} gems`,
    });
    
    return NextResponse.json({
      success: true,
      deposit: {
        solAmount,
        gemsAmount,
        newBalance: balanceAfter,
      },
    });
  } catch (error) {
    console.error('Deposit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

