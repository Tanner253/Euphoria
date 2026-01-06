/**
 * Server-side game configuration
 * This is the AUTHORITATIVE source - clients must match these values
 */

export const SERVER_CONFIG = {
  // Server settings
  PORT: parseInt(process.env.PORT || '3002'),
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
  
  // Game tick rate (how often server broadcasts state)
  TICK_RATE: 60, // 60 updates per second
  TICK_MS: 1000 / 60,
  
  // Grid settings (must match client)
  CELL_SIZE: 50,
  CELL_SIZE_MOBILE: 40,
  
  // Zoom levels
  ZOOM_LEVELS: [2.0, 1.0, 0.75] as const,
  
  // Grid speed based on volatility - MUST MATCH CLIENT
  GRID_SPEED_ACTIVE: 1,
  GRID_SPEED_LOW: 0.25,
  GRID_SPEED_IDLE: 0.05,
  GRID_SPEED_MIN: 0.03,
  
  // Price visualization - MUST MATCH CLIENT
  PRICE_SCALE: 8000,
  
  // === SMOOTHING SETTINGS ===
  // These create smooth, natural price line movement
  
  // Raw price input smoothing (EMA alpha)
  // Higher = more responsive (0.3 = responsive, 0.05 = sluggish)
  PRICE_INPUT_SMOOTHING: 0.25,
  
  // Price Y position smoothing - how fast priceY catches up to target
  // Higher = faster response (0.15 = smooth but responsive)
  PRICE_SMOOTHING: 0.15,
  
  // Dead zone - minimum Y movement required before target updates
  // Prevents micro-oscillations (in pixels)
  PRICE_DEAD_ZONE: 1,
  
  // Velocity damping - reduces rapid direction changes
  // Lower = more responsive (0.7 = responsive, 0.95 = sluggish)
  PRICE_VELOCITY_DAMPING: 0.5,
  
  // Maximum velocity to prevent sudden jumps (pixels per tick)
  PRICE_MAX_VELOCITY: 15,
  
  // Price history recording interval (in world X pixels)
  // Lower = more points = smoother curves
  PRICE_HISTORY_INTERVAL: 2,
  
  // Volatility detection
  FLATLINE_THRESHOLD: 0.003,
  FLATLINE_WINDOW: 60,
  
  // Layout
  HEAD_X: 450,
  HEAD_X_MOBILE: 60,
  VERTICAL_CELLS: 60,
  
  // House edge (subtle - should not be visibly obvious)
  // MUST MATCH CLIENT GAME_CONFIG.WIN_ZONE_MARGIN
  WIN_ZONE_MARGIN: 0.15,
  BET_AVOIDANCE_STRENGTH: 0.225,  // Matches client
  BET_AVOIDANCE_CAP: 0.45,        // Matches client
  
  // Price history
  MAX_PRICE_HISTORY: 5000,
  MAX_COLUMNS: 500,
} as const;

export type ServerConfig = typeof SERVER_CONFIG;

