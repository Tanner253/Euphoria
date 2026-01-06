/**
 * Client-side VISUAL configuration ONLY
 * 
 * ALL game mechanics config comes from the server via Socket.io.
 * The client MUST wait for serverConfig before rendering the game.
 * 
 * This file ONLY contains:
 * - Colors and visual effects (pure rendering, no game logic)
 * - Demo mode initial balance
 */

export const VISUAL_CONFIG = {
  // Colors - purely visual, no game logic impact
  WIN_COLOR: '#c8e64c',
  LOSS_COLOR: '#ef4444',
  BG_COLOR: '#0a0014',
  GRID_LINE_COLOR: 'rgba(255, 100, 150, 0.12)',
  GRID_DOT_COLOR: 'rgba(255, 100, 150, 0.35)',
  PRICE_LINE_COLOR: '#ff66aa',
  PRICE_LINE_GLOW: '#ff99cc',
  
  // Demo mode initial balance (before user authenticates)
  INITIAL_BALANCE: 1000,
} as const;

// Legacy alias for backwards compatibility during migration
export const GAME_CONFIG = VISUAL_CONFIG;

/**
 * Calculate multiplier based on distance from current price and risk level
 * 
 * NOTE: Server is authoritative for actual bet multipliers.
 * Client uses this for preview/display only.
 */
export function calculateMultiplier(yIndex: number, currentPriceIndex: number, zoomLevel: number = 1.0): string {
  const dist = Math.abs(yIndex - currentPriceIndex);
  
  let baseMultiplier: number;
  let minMultiplier: number;
  
  if (zoomLevel >= 1.5) {
    baseMultiplier = 0.435;
    minMultiplier = 1.15;
  } else if (zoomLevel >= 0.9) {
    baseMultiplier = 0.5625;
    minMultiplier = 1.12;
  } else {
    baseMultiplier = 0.75;
    minMultiplier = 1.50;
  }
  
  let mult = (baseMultiplier + Math.pow(dist, 1.25) * 0.21) * 2;
  mult = Math.min(Math.max(mult, minMultiplier), 75.0);
  
  if (mult >= 10) {
    return Math.round(mult).toString();
  }
  return mult.toFixed(2);
}

export type VolatilityLevel = 'active' | 'low' | 'idle';

/**
 * Server config type - received from server on socket connect
 * Client MUST wait for this before rendering the game
 */
export interface ServerConfig {
  // Grid
  cellSize: number;
  cellSizeMobile: number;
  
  // Zoom
  zoomLevels: readonly number[];
  zoomLabels: readonly string[];
  
  // Grid speed
  gridSpeedActive: number;
  gridSpeedLow: number;
  gridSpeedIdle: number;
  gridSpeedMin: number;
  
  // Price
  priceScale: number;
  priceSmoothing: number;
  flatlineThreshold: number;
  flatlineWindow: number;
  
  // Betting rules
  minBetColumnsAhead: number;
  minBetColumnsAheadMobile: number;
  betAmountOptions: readonly number[];
  betAmountOptionsMobile: readonly number[];
  maxBetAmount: number;
  minBetAmount: number;
  
  // House edge
  winZoneMargin: number;
  
  // Layout
  headX: number;
  headXMobile: number;
  verticalCells: number;
  priceAxisWidth: number;
  priceAxisWidthMobile: number;
  sidebarWidth: number;
  sidebarWidthMobile: number;
  mobileCameraScale: number;
  
  // Server
  tickRate: number;
}

