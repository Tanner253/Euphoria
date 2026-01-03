/**
 * POST /api/auth/verify
 * Verify x403 payload and create session
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyX403Payload } from '@/lib/auth/x403Verify';
import { createToken } from '@/lib/auth/jwt';
import { UserService } from '@/lib/db/services';
import logger from '@/lib/utils/secureLogger';

export async function POST(request: NextRequest) {
  try {
    const { payload } = await request.json();
    
    if (!payload) {
      return NextResponse.json(
        { error: 'Missing x403 payload' },
        { status: 400 }
      );
    }
    
    // Verify the x403 signature
    const verification = verifyX403Payload(payload);
    
    if (!verification.valid || !verification.walletAddress) {
      return NextResponse.json(
        { error: verification.error || 'Invalid signature' },
        { status: 401 }
      );
    }
    
    // Get request metadata
    const ipAddress = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      'unknown';
    const userAgent = request.headers.get('user-agent') || undefined;
    
    // Find or create user
    const { user, isNew } = await UserService.getInstance().findOrCreateUser(
      verification.walletAddress,
      { ipAddress, userAgent }
    );
    
    // Check if user is suspended/banned
    if (user.status !== 'active') {
      return NextResponse.json(
        { error: `Account is ${user.status}`, reason: user.suspensionReason },
        { status: 403 }
      );
    }
    
    // Create JWT for subsequent requests
    const token = createToken(verification.walletAddress);
    
    return NextResponse.json({
      success: true,
      token,
      user: {
        walletAddress: user.walletAddress,
        gemsBalance: user.gemsBalance,
        totalBets: user.totalBets,
        totalWins: user.totalWins,
        isNew,
      }
    });
    
  } catch (error) {
    logger.error('[API] Auth verify error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

