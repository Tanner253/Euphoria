import { NextRequest, NextResponse } from 'next/server';
import { GAME_CONFIG, calculateMultiplier } from '@/lib/game/config';
import crypto from 'crypto';

const ODDS_SECRET = process.env.ODDS_SECRET || 'demo-secret-change-in-production';

/**
 * GET /api/game/odds
 * Get current odds/multipliers for grid cells
 * 
 * Returns signed odds that the client can use when placing bets
 * This prevents the client from manipulating multipliers
 */
export async function GET(request: NextRequest) {
  const currentPriceYIndex = parseInt(request.nextUrl.searchParams.get('priceYIndex') || '0');
  const columnX = parseInt(request.nextUrl.searchParams.get('columnX') || '0');
  const range = parseInt(request.nextUrl.searchParams.get('range') || '15');
  
  const odds: Array<{
    yIndex: number;
    multiplier: number;
    oddsId: string;
    signature: string;
  }> = [];
  
  for (let i = -range; i <= range; i++) {
    const yIndex = currentPriceYIndex + i;
    const multiplier = calculateMultiplier(yIndex, currentPriceYIndex);
    const oddsId = crypto.randomUUID();
    
    // Sign the odds so client can't tamper
    const data = `${oddsId}:${multiplier}:${columnX}:${yIndex}`;
    const signature = crypto.createHmac('sha256', ODDS_SECRET).update(data).digest('hex');
    
    odds.push({
      yIndex,
      multiplier: parseFloat(multiplier.toFixed(2)),
      oddsId,
      signature,
    });
  }
  
  return NextResponse.json({
    odds,
    config: {
      houseEdge: GAME_CONFIG.HOUSE_EDGE,
      minMultiplier: GAME_CONFIG.MIN_MULTIPLIER,
      maxMultiplier: GAME_CONFIG.MAX_MULTIPLIER,
    },
    generatedAt: Date.now(),
    expiresAt: Date.now() + 60000, // 1 minute validity
  });
}

