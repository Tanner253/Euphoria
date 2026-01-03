import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/lib/models';

/**
 * POST /api/user/connect
 * Connect wallet and get/create user
 */
export async function POST(request: NextRequest) {
  try {
    const { walletAddress } = await request.json();
    
    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json(
        { error: 'Invalid wallet address' },
        { status: 400 }
      );
    }
    
    // Normalize wallet address
    const normalizedAddress = walletAddress.toLowerCase().trim();
    
    // Validate format (basic Solana address validation)
    if (normalizedAddress.length < 32 || normalizedAddress.length > 44) {
      return NextResponse.json(
        { error: 'Invalid Solana wallet address format' },
        { status: 400 }
      );
    }
    
    await connectToDatabase();
    
    // Find or create user
    let user = await User.findOne({ walletAddress: normalizedAddress });
    
    if (!user) {
      user = await User.create({
        walletAddress: normalizedAddress,
        balance: 0,
      });
    }
    
    return NextResponse.json({
      success: true,
      user: {
        id: user._id.toString(),
        walletAddress: user.walletAddress,
        balance: user.balance,
        totalDeposited: user.totalDeposited,
        totalWithdrawn: user.totalWithdrawn,
        totalWagered: user.totalWagered,
        totalWon: user.totalWon,
      },
    });
  } catch (error) {
    console.error('User connect error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

