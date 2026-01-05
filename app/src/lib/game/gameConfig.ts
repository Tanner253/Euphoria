/**
 * Client-side game configuration
 * Visual and gameplay settings for the prediction market
 */

export const GAME_CONFIG = {
  // Grid dimensions
  CELL_SIZE: 50,
  CELL_SIZE_MOBILE: 40,  // Smaller cells to fit more on screen (was 55)
  
  // Zoom levels (larger = zoomed in = bigger cells = lower risk, smaller = zoomed out = higher risk)
  ZOOM_LEVELS: [2.0, 1.0, 0.75] as const,
  ZOOM_LABELS: ['Low Risk', 'Medium', 'High Risk'] as const,
  
  // Grid speed based on volatility
  // Speed scales with price movement - nearly stops during flatlines
  GRID_SPEED_ACTIVE: 0.8,      // Full speed during high volatility
  GRID_SPEED_LOW: 0.15,        // Reduced speed during low volatility  
  GRID_SPEED_IDLE: 0.02,       // Near-crawl during flatline (was 0.08 - too fast!)
  
  // Price visualization
  PRICE_SCALE: 2500,
  PRICE_SMOOTHING: 0.08,
  // Flatline detection - more sensitive to catch low-volume periods
  FLATLINE_THRESHOLD: 0.003,   // Was 0.002 - detect flatlines earlier
  FLATLINE_WINDOW: 60,         // Was 90 - shorter window for faster response
  
  // Betting options
  BET_AMOUNT_OPTIONS: [10, 25, 50, 100] as number[],
  BET_AMOUNT_OPTIONS_MOBILE: [1, 5, 10] as number[],
  MAX_BET_AMOUNT: 100,
  INITIAL_BALANCE: 1000,
  MIN_BET_COLUMNS_AHEAD: 10,        // Desktop: force bets further ahead
  MIN_BET_COLUMNS_AHEAD_MOBILE: 6,  // Mobile: fewer columns due to screen width
  
  // HOUSE EDGE: Win zone shrinkage
  // Shrinks the "hitbox" of each cell - price must enter inner portion to win
  // 0.0 = full cell (easy), 0.3 = 70% of cell (harder), 0.5 = 50% of cell (very hard)
  WIN_ZONE_MARGIN: 0.15,  // 15% margin on each side = 70% effective cell size
  
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
  PRICE_AXIS_WIDTH_MOBILE: 40,  // Narrower on mobile
  HEAD_X: 450,
  HEAD_X_MOBILE: 60,  // Very close to left edge to maximize betting area
  VERTICAL_CELLS: 30,
  
  // Sidebar
  SIDEBAR_WIDTH: 56,
  SIDEBAR_WIDTH_MOBILE: 44,  // Narrower on mobile
  
  // Mobile camera zoom-out (visual only, doesn't affect game mechanics)
  // 0.55 = render at 55% size, showing ~80% more of the grid
  // Balanced to see 6+ columns ahead with smaller cells
  MOBILE_CAMERA_SCALE: 0.55,
} as const;

/**
 * Calculate multiplier based on distance from current price and risk level
 * 
 * Risk level starting multipliers (for bets on the price line):
 * - Low Risk (2.0x zoom): starts at 1.15x (unchanged - minimum payout)
 * - Medium (1.0x zoom): starts at 1.12x  
 * - High Risk (0.75x zoom): starts at 1.50x
 * 
 * Higher distance from price = higher multiplier
 * 
 * NOTE: All multipliers reduced by 25% (except low risk minimum) to improve house edge
 */
export function calculateMultiplier(yIndex: number, currentPriceIndex: number, zoomLevel: number = 1.0): string {
  const dist = Math.abs(yIndex - currentPriceIndex);
  
  // Base multiplier and minimum depend on risk level (zoom)
  // All values reduced by 25% except low risk minimum (1.15)
  let baseMultiplier: number;
  let minMultiplier: number;
  
  if (zoomLevel >= 1.5) {
    // Low Risk - easier wins, lower payouts (minimum stays at 1.15x)
    baseMultiplier = 0.435;   // Was 0.58 (-25%)
    minMultiplier = 1.15;     // UNCHANGED - minimum payout floor
  } else if (zoomLevel >= 0.9) {
    // Medium Risk - balanced
    baseMultiplier = 0.5625;  // Was 0.75 (-25%)
    minMultiplier = 1.12;     // Was 1.50 (-25%)
  } else {
    // High Risk - harder wins, higher payouts
    baseMultiplier = 0.75;    // Was 1.00 (-25%)
    minMultiplier = 1.50;     // Was 2.00 (-25%)
  }
  
  // Formula: (base + (dist^1.25) * 0.21) * 2
  // Distance coefficient reduced from 0.28 to 0.21 (-25%)
  let mult = (baseMultiplier + Math.pow(dist, 1.25) * 0.21) * 2;
  
  // Apply minimum based on risk level, cap at 75x (was 100x, -25%)
  mult = Math.min(Math.max(mult, minMultiplier), 75.0);
  
  // No decimals for double-digit multipliers (cleaner display)
  if (mult >= 10) {
    return Math.round(mult).toString();
  }
  return mult.toFixed(2);
}

export type VolatilityLevel = 'active' | 'low' | 'idle';

