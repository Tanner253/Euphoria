/**
 * Server-authoritative game configuration
 * These values are used for bet validation and resolution
 */
export const GAME_CONFIG = {
  // Grid dimensions (must match client)
  CELL_WIDTH: 80,
  CELL_HEIGHT: 50,
  GRID_SPEED: 1, // pixels per frame at 60fps
  
  // Price scaling: converts SOL price changes to grid Y movement
  // e.g., $1 change in SOL = PRICE_SCALE pixels on grid
  PRICE_SCALE: 500, // Adjust based on desired sensitivity
  
  // Betting
  MIN_BET: 1,
  MAX_BET: 10000,
  MIN_MULTIPLIER: 1.01,
  MAX_MULTIPLIER: 50,
  
  // House edge (percentage taken from winnings)
  HOUSE_EDGE: 0.02, // 2%
  
  // Minimum distance ahead to place bet (in columns)
  MIN_BET_DISTANCE_COLUMNS: 2,
  
  // Currency conversion: 1 SOL = X gems
  SOL_TO_GEMS_RATE: 1000, // 1 SOL = 1000 gems
  
  // Withdrawal minimum
  MIN_WITHDRAWAL_GEMS: 100,
  
  // Bet resolution timeout (ms)
  BET_RESOLUTION_TIMEOUT: 60000, // 1 minute max for a bet to resolve
} as const;

/**
 * Calculate multiplier based on distance from current price
 * Higher distance = higher multiplier (more risk)
 */
export function calculateMultiplier(yIndex: number, currentPriceIndex: number): number {
  const dist = Math.abs(yIndex - currentPriceIndex);
  // Base 1.2x, scales up exponentially with distance
  let mult = 1.2 + Math.pow(dist, 1.6) * 0.4;
  
  // Apply house edge
  mult = mult * (1 - GAME_CONFIG.HOUSE_EDGE);
  
  return Math.min(Math.max(mult, GAME_CONFIG.MIN_MULTIPLIER), GAME_CONFIG.MAX_MULTIPLIER);
}

/**
 * Convert SOL price to grid Y coordinate
 */
export function priceToGridY(price: number, basePrice: number): number {
  const priceDelta = price - basePrice;
  return priceDelta * GAME_CONFIG.PRICE_SCALE;
}

/**
 * Get Y index from Y coordinate
 */
export function getYIndex(y: number): number {
  return Math.round(y / GAME_CONFIG.CELL_HEIGHT);
}

/**
 * Get Y coordinate from Y index
 */
export function getYFromIndex(index: number): number {
  return index * GAME_CONFIG.CELL_HEIGHT;
}

