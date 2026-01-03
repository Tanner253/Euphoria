/**
 * GET /api/user/me
 * Get current user's data and stats
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedWallet } from '@/lib/auth/jwt';
import { UserService } from '@/lib/db/services';
import logger from '@/lib/utils/secureLogger';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const walletAddress = getAuthenticatedWallet(authHeader);
    
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const user = await UserService.getInstance().getUser(walletAddress);
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    
    const stats = await UserService.getInstance().getUserStats(walletAddress);
    
    return NextResponse.json({
      user: {
        walletAddress: user.walletAddress,
        gemsBalance: user.gemsBalance,
        status: user.status,
        createdAt: user.createdAt,
        lastActiveAt: user.lastActiveAt,
      },
      stats
    });
    
  } catch (error) {
    logger.error('[API] Get user error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

