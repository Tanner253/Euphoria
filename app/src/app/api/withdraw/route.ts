import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { User, Transaction } from '@/lib/models';
import { GAME_CONFIG } from '@/lib/game/config';

/**
 * POST /api/withdraw
 * Request a withdrawal (converts gems back to SOL)
 * 
 * For demo: Just deduct balance and return simulated tx
 * For production: Queue withdrawal and send SOL from custodial wallet
 */
export async function POST(request: NextRequest) {
  try {
    const { walletAddress, gemsAmount } = await request.json();
    
    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json(
        { error: 'Invalid wallet address' },
        { status: 400 }
      );
    }
    
    if (!gemsAmount || typeof gemsAmount !== 'number' || gemsAmount <= 0) {
      return NextResponse.json(
        { error: 'Invalid withdrawal amount' },
        { status: 400 }
      );
    }
    
    if (gemsAmount < GAME_CONFIG.MIN_WITHDRAWAL_GEMS) {
      return NextResponse.json(
        { error: `Minimum withdrawal is ${GAME_CONFIG.MIN_WITHDRAWAL_GEMS} gems` },
        { status: 400 }
      );
    }
    
    const normalizedAddress = walletAddress.toLowerCase().trim();
    
    await connectToDatabase();
    
    // Find user
    const user = await User.findOne({ walletAddress: normalizedAddress });
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    
    // Check balance
    if (user.balance < gemsAmount) {
      return NextResponse.json(
        { error: 'Insufficient balance' },
        { status: 400 }
      );
    }
    
    // Convert gems to SOL
    const solAmount = gemsAmount / GAME_CONFIG.SOL_TO_GEMS_RATE;
    
    const balanceBefore = user.balance;
    const balanceAfter = balanceBefore - gemsAmount;
    
    // Update user balance
    user.balance = balanceAfter;
    user.totalWithdrawn += gemsAmount;
    await user.save();
    
    // Generate simulated transaction hash
    const simulatedTxHash = `sim_withdraw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // TODO: In production, queue actual SOL transfer here
    // const txHash = await sendSolFromCustodial(walletAddress, solAmount);
    
    // Create transaction record
    await Transaction.create({
      user: user._id,
      walletAddress: normalizedAddress,
      type: 'withdrawal',
      amount: -gemsAmount, // Negative for withdrawals
      balanceBefore,
      balanceAfter,
      status: 'completed', // In production: 'pending' until confirmed
      solAmount,
      txHash: simulatedTxHash,
      description: `Withdrew ${gemsAmount} gems → ${solAmount} SOL`,
    });
    
    return NextResponse.json({
      success: true,
      withdrawal: {
        gemsAmount,
        solAmount,
        newBalance: balanceAfter,
        txHash: simulatedTxHash,
        status: 'completed', // In production: 'pending'
      },
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

