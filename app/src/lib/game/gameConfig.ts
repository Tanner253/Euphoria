/**
 * Client-side game configuration
 * Visual and gameplay settings for the prediction market
 */

export const GAME_CONFIG = {
  // Grid dimensions - LARGER cells on mobile for readability
  CELL_SIZE: 50,
  CELL_SIZE_MOBILE: 55,  // Larger than desktop for touch targets
  
  // Zoom levels (larger = zoomed in = bigger cells = lower risk, smaller = zoomed out = higher risk)
  ZOOM_LEVELS: [2.0, 1.0, 0.75] as const,
  ZOOM_LABELS: ['Low Risk', 'Medium', 'High Risk'] as const,
  
  // Grid speed based on volatility
  GRID_SPEED_ACTIVE: 0.8,
  GRID_SPEED_IDLE: 0.08,
  
  // Price visualization
  PRICE_SCALE: 2500,
  PRICE_SMOOTHING: 0.08,
  FLATLINE_THRESHOLD: 0.002,
  FLATLINE_WINDOW: 90,
  
  // Betting options
  BET_AMOUNT_OPTIONS: [10, 25, 50, 100] as number[],
  BET_AMOUNT_OPTIONS_MOBILE: [1, 5, 10] as number[],
  MAX_BET_AMOUNT: 100,
  INITIAL_BALANCE: 1000,
  MIN_BET_COLUMNS_AHEAD: 3,  // Reduced for mobile
  
  // Colors
  WIN_COLOR: '#c8e64c',
  LOSS_COLOR: '#ef4444',
  BG_COLOR: '#0a0014',
  GRID_LINE_COLOR: 'rgba(255, 100, 150, 0.12)',
  GRID_DOT_COLOR: 'rgba(255, 100, 150, 0.35)',
  PRICE_LINE_COLOR: '#ff66aa',
  PRICE_LINE_GLOW: '#ff99cc',
  
  // Layout - adjusted for mobile portrait
  PRICE_AXIS_WIDTH: 80,
  PRICE_AXIS_WIDTH_MOBILE: 50,  // Narrower on mobile
  HEAD_X: 450,
  HEAD_X_MOBILE: 100,  // Much closer to left edge for portrait
  VERTICAL_CELLS: 30,
  
  // Sidebar
  SIDEBAR_WIDTH: 56,
  SIDEBAR_WIDTH_MOBILE: 44,  // Narrower on mobile
  
  // Mobile camera zoom-out (visual only, doesn't affect game mechanics)
  // 0.65 = render at 65% size, showing ~54% more of the grid
  MOBILE_CAMERA_SCALE: 0.65,
} as const;

/**
 * Calculate multiplier based on distance from current price and risk level
 * 
 * Risk level starting multipliers (for bets on the price line):
 * - Low Risk (2.0x zoom): starts at 1.15x
 * - Medium (1.0x zoom): starts at 1.50x  
 * - High Risk (0.75x zoom): starts at 2.00x
 * 
 * Higher distance from price = higher multiplier
 */
export function calculateMultiplier(yIndex: number, currentPriceIndex: number, zoomLevel: number = 1.0): string {
  const dist = Math.abs(yIndex - currentPriceIndex);
  
  // Base multiplier and minimum depend on risk level (zoom)
  let baseMultiplier: number;
  let minMultiplier: number;
  
  if (zoomLevel >= 1.5) {
    // Low Risk - easier wins, lower payouts (starts at 1.15x)
    baseMultiplier = 0.58;
    minMultiplier = 1.15;
  } else if (zoomLevel >= 0.9) {
    // Medium Risk - balanced (starts at 1.5x)
    baseMultiplier = 0.75;
    minMultiplier = 1.50;
  } else {
    // High Risk - harder wins, higher payouts (starts at 2.0x)
    baseMultiplier = 1.00;
    minMultiplier = 2.00;
  }
  
  // Formula: (base + (dist^1.25) * 0.28) * 2
  let mult = (baseMultiplier + Math.pow(dist, 1.25) * 0.28) * 2;
  
  // Apply minimum based on risk level, cap at 100x
  mult = Math.min(Math.max(mult, minMultiplier), 100.0);
  
  // No decimals for double-digit multipliers (cleaner display)
  if (mult >= 10) {
    return Math.round(mult).toString();
  }
  return mult.toFixed(2);
}

export type VolatilityLevel = 'active' | 'low' | 'idle';

