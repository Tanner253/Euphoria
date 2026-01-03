import { NextRequest, NextResponse } from 'next/server';
import { GAME_CONFIG, calculateMultiplier, getYIndex } from '@/lib/game/config';

// Server-side game state
// In production, this would be managed by a separate service or Redis
interface GameState {
  worldX: number;
  basePrice: number | null;
  currentPrice: number | null;
  priceY: number;
  lastUpdate: number;
  sessionId: string;
}

// Simple in-memory state for demo
// Each Vercel function invocation is stateless, so this won't persist
// In production, use Redis or a database for shared state
const gameState: GameState = {
  worldX: 0,
  basePrice: null,
  currentPrice: null,
  priceY: 0,
  lastUpdate: Date.now(),
  sessionId: Math.random().toString(36).substr(2, 9),
};

/**
 * GET /api/game/state
 * Get current authoritative game state
 */
export async function GET() {
  return NextResponse.json({
    config: {
      cellWidth: GAME_CONFIG.CELL_WIDTH,
      cellHeight: GAME_CONFIG.CELL_HEIGHT,
      gridSpeed: GAME_CONFIG.GRID_SPEED,
      priceScale: GAME_CONFIG.PRICE_SCALE,
      minBet: GAME_CONFIG.MIN_BET,
      maxBet: GAME_CONFIG.MAX_BET,
      minBetDistanceColumns: GAME_CONFIG.MIN_BET_DISTANCE_COLUMNS,
      solToGemsRate: GAME_CONFIG.SOL_TO_GEMS_RATE,
      houseEdge: GAME_CONFIG.HOUSE_EDGE,
    },
    state: {
      worldX: gameState.worldX,
      basePrice: gameState.basePrice,
      currentPrice: gameState.currentPrice,
      priceY: gameState.priceY,
      lastUpdate: gameState.lastUpdate,
      sessionId: gameState.sessionId,
    },
  });
}

/**
 * POST /api/game/state
 * Update game state (for demo mode, client reports state)
 * In production, this would be server-authoritative
 */
export async function POST(request: NextRequest) {
  try {
    const { worldX, currentPrice, priceY } = await request.json();
    
    // Update state
    if (typeof worldX === 'number') {
      gameState.worldX = worldX;
    }
    
    if (typeof currentPrice === 'number') {
      if (gameState.basePrice === null) {
        gameState.basePrice = currentPrice;
      }
      gameState.currentPrice = currentPrice;
    }
    
    if (typeof priceY === 'number') {
      gameState.priceY = priceY;
    }
    
    gameState.lastUpdate = Date.now();
    
    return NextResponse.json({
      success: true,
      state: gameState,
    });
  } catch (error) {
    console.error('Game state update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

