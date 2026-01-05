'use client';

/**
 * useAutoPlay - Automatic demo mode for development testing
 * 
 * ONLY available in development mode (NODE_ENV=development)
 * Simulates realistic human-like betting based on price movements
 * Uses INFINITE GEMS - balance never decreases
 */

import { useCallback, useEffect, useRef } from 'react';
import { GAME_CONFIG } from '@/lib/game/gameConfig';

interface PricePoint {
  price: number;
  timestamp: number;
}

interface AutoPlayOptions {
  isEnabled: boolean;
  isAutoPlaying: boolean;
  setIsAutoPlaying: (value: boolean) => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  currentPrice: number | null;
  balance: number;
  betAmount: number;
  isMobile: boolean;
  sidebarWidth: number;
  zoomIndex: number;
  onPlaceBet: (screenX: number, screenY: number) => void;
}

interface AutoPlayReturn {
  toggleAutoPlay: () => void;
  canAutoPlay: boolean;
}

// Only allow in development
const IS_DEV = process.env.NODE_ENV === 'development';

export function useAutoPlay({
  isEnabled,
  isAutoPlaying,
  setIsAutoPlaying,
  canvasRef,
  currentPrice,
  betAmount,
  isMobile,
  zoomIndex,
  onPlaceBet,
}: AutoPlayOptions): AutoPlayReturn {
  // Price history for trend analysis
  const priceHistoryRef = useRef<PricePoint[]>([]);
  const lastBetTimeRef = useRef<number>(0);
  const lastPriceRef = useRef<number | null>(null);
  
  // Track price changes
  useEffect(() => {
    if (!IS_DEV || !isEnabled || !isAutoPlaying || currentPrice === null) return;
    
    const now = Date.now();
    priceHistoryRef.current.push({ price: currentPrice, timestamp: now });
    
    // Keep last 100 price points (~1.6 seconds at 60fps)
    if (priceHistoryRef.current.length > 100) {
      priceHistoryRef.current.shift();
    }
    
    lastPriceRef.current = currentPrice;
  }, [currentPrice, isAutoPlaying, isEnabled]);
  
  // Analyze price trend
  const analyzeTrend = useCallback((): { direction: 'up' | 'down' | 'neutral'; strength: number; volatility: number } => {
    const history = priceHistoryRef.current;
    if (history.length < 20) {
      return { direction: 'neutral', strength: 0, volatility: 0 };
    }
    
    // Get recent vs older prices
    const recentSlice = history.slice(-10);
    const olderSlice = history.slice(-30, -20);
    
    if (olderSlice.length === 0) {
      return { direction: 'neutral', strength: 0, volatility: 0 };
    }
    
    const recentAvg = recentSlice.reduce((sum, p) => sum + p.price, 0) / recentSlice.length;
    const olderAvg = olderSlice.reduce((sum, p) => sum + p.price, 0) / olderSlice.length;
    
    const diff = recentAvg - olderAvg;
    const percentChange = (diff / olderAvg) * 100;
    
    // Calculate volatility (standard deviation of recent prices)
    const variance = recentSlice.reduce((sum, p) => sum + Math.pow(p.price - recentAvg, 2), 0) / recentSlice.length;
    const volatility = Math.sqrt(variance) / recentAvg * 100;
    
    let direction: 'up' | 'down' | 'neutral' = 'neutral';
    if (percentChange > 0.01) direction = 'up';
    else if (percentChange < -0.01) direction = 'down';
    
    return {
      direction,
      strength: Math.abs(percentChange),
      volatility,
    };
  }, []);
  
  // Calculate where to place bet based on trend
  const calculateBetPosition = useCallback((): { screenX: number; screenY: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || currentPrice === null) return null;
    
    const trend = analyzeTrend();
    // IMPORTANT: Use zoomed cell size to match game engine
    const zoomLevel = GAME_CONFIG.ZOOM_LEVELS[zoomIndex] || 1.0;
    const baseCellSize = isMobile ? GAME_CONFIG.CELL_SIZE_MOBILE : GAME_CONFIG.CELL_SIZE;
    const cellSize = Math.floor(baseCellSize * zoomLevel);
    const headX = isMobile ? GAME_CONFIG.HEAD_X_MOBILE : GAME_CONFIG.HEAD_X;
    
    // Use the actual minimum bet distance from config
    const minBetColumnsAhead = isMobile 
      ? GAME_CONFIG.MIN_BET_COLUMNS_AHEAD_MOBILE 
      : GAME_CONFIG.MIN_BET_COLUMNS_AHEAD;
    
    // Virtual dimensions (what the game renders to after cameraScale is applied)
    const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
    const virtualWidth = canvas.width / cameraScale;
    const virtualHeight = canvas.height / cameraScale;
    
    // Price line is roughly at center Y in virtual space
    const centerY = virtualHeight / 2;
    
    // Bet X position: minBetColumnsAhead + 1-4 extra columns for variety
    // Calculate in VIRTUAL coordinates (not scaled)
    const extraColumns = 1 + Math.floor(Math.random() * 4); // 1-4 extra columns
    const columnsAhead = minBetColumnsAhead + extraColumns;
    const virtualBetX = headX + columnsAhead * cellSize;
    
    // Bet Y position based on trend prediction (in virtual coords)
    let cellOffset = 0;
    
    if (trend.direction === 'up') {
      const confidence = Math.min(trend.strength * 20, 3);
      cellOffset = -Math.floor(1 + Math.random() * (2 + confidence));
    } else if (trend.direction === 'down') {
      const confidence = Math.min(trend.strength * 20, 3);
      cellOffset = Math.floor(1 + Math.random() * (2 + confidence));
    } else {
      cellOffset = Math.floor(Math.random() * 5) - 2;
    }
    
    if (Math.random() < 0.3) {
      cellOffset += Math.floor(Math.random() * 3) - 1;
    }
    
    if (trend.volatility > 0.1) {
      cellOffset = Math.round(cellOffset * 0.6);
    }
    
    const virtualBetY = centerY + cellOffset * cellSize;
    
    // Clamp to valid virtual canvas area
    const minX = headX + (minBetColumnsAhead + 1) * cellSize;
    const clampedVirtualX = Math.max(minX, Math.min(virtualBetX, virtualWidth - 50));
    const clampedVirtualY = Math.max(cellSize * 2, Math.min(virtualBetY, virtualHeight - cellSize * 2));
    
    // Return VIRTUAL coordinates - placeBetAt expects coordinates already divided by cameraScale
    // (just like handlePointerDown divides client coords by cameraScale before passing)
    return { 
      screenX: clampedVirtualX, 
      screenY: clampedVirtualY 
    };
  }, [canvasRef, currentPrice, isMobile, analyzeTrend]);
  
  // Auto-play loop - INFINITE GEMS mode (no balance check needed)
  useEffect(() => {
    if (!IS_DEV || !isEnabled || !isAutoPlaying) return;
    
    const interval = setInterval(() => {
      const now = Date.now();
      
      // Human-like betting frequency: 3-8 seconds between bets (slower, more realistic)
      const minDelay = 3000;
      const maxDelay = 8000;
      const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
      
      if (now - lastBetTimeRef.current < randomDelay) return;
      
      // Skip sometimes (humans don't bet every possible moment) - 50% skip chance
      if (Math.random() < 0.5) return;
      
      const betPosition = calculateBetPosition();
      if (!betPosition) return;
      
      // Place the bet (infinite gems - no balance check)
      onPlaceBet(betPosition.screenX, betPosition.screenY);
      lastBetTimeRef.current = now;
      
    }, 500); // Check every 500ms
    
    return () => clearInterval(interval);
  }, [isEnabled, isAutoPlaying, betAmount, calculateBetPosition, onPlaceBet]);
  
  const toggleAutoPlay = useCallback(() => {
    if (!IS_DEV) return;
    
    const newValue = !isAutoPlaying;
    setIsAutoPlaying(newValue);
    
    // Reset state when toggling on
    if (newValue) {
      priceHistoryRef.current = [];
      lastBetTimeRef.current = 0;
    }
  }, [isAutoPlaying, setIsAutoPlaying]);
  
  return {
    toggleAutoPlay,
    canAutoPlay: IS_DEV && isEnabled,
  };
}
