/**
 * Client-side VISUAL configuration ONLY
 * 
 * IMPORTANT: Game mechanics config (cell sizes, zoom levels, betting rules, etc.)
 * come from the server via useGameSocket().serverConfig
 * 
 * This file ONLY contains:
 * - Colors and visual effects
 * - Initial/demo balance (before auth)
 * - Things that truly don't affect game logic
 */

export const GAME_CONFIG = {
  // === VISUAL ONLY - These do not affect game logic ===
  
  // Colors
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

/**
 * Calculate multiplier based on distance from current price and risk level
 * 
 * NOTE: This is computed by the server for authoritative bets.
 * Client uses this for preview/display only until server confirms.
 * 
 * Risk level starting multipliers (for bets on the price line):
 * - Low Risk (2.0x zoom): starts at 1.15x
 * - Medium (1.0x zoom): starts at 1.12x  
 * - High Risk (0.75x zoom): starts at 1.50x
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
 * Default server config values used as fallback before server connection
 * These MUST match server/src/config.ts SERVER_CONFIG
 */
export const DEFAULT_SERVER_CONFIG = {
  // Grid
  cellSize: 50,
  cellSizeMobile: 40,
  
  // Zoom
  zoomLevels: [2.0, 1.0, 0.75] as readonly number[],
  zoomLabels: ['Low Risk', 'Medium', 'High Risk'] as readonly string[],
  
  // Grid speed
  gridSpeedActive: 1,
  gridSpeedLow: 0.25,
  gridSpeedIdle: 0.05,
  gridSpeedMin: 0.03,
  
  // Price
  priceScale: 8000,
  priceSmoothing: 0.15,
  flatlineThreshold: 0.003,
  flatlineWindow: 60,
  
  // Betting rules
  minBetColumnsAhead: 8,
  minBetColumnsAheadMobile: 5,
  betAmountOptions: [10, 25, 50, 100] as readonly number[],
  betAmountOptionsMobile: [1, 5, 10] as readonly number[],
  maxBetAmount: 100,
  minBetAmount: 1,
  
  // House edge
  winZoneMargin: 0.15,
  
  // Layout
  headX: 450,
  headXMobile: 60,
  verticalCells: 60,
  priceAxisWidth: 80,
  priceAxisWidthMobile: 40,
  sidebarWidth: 56,
  sidebarWidthMobile: 44,
  mobileCameraScale: 0.55,
  
  // Server
  tickRate: 60,
} as const;

export type ServerConfig = typeof DEFAULT_SERVER_CONFIG;

