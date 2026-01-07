/**
 * Server-side game configuration
 * This is the SINGLE SOURCE OF TRUTH for all game settings.
 * Clients MUST fetch this config from the server and use it.
 * DO NOT duplicate these values in client code.
 */

export const SERVER_CONFIG = {
  // Server settings
  PORT: parseInt(process.env.PORT || '3002'),
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
  
  // Game tick rate (how often server broadcasts state)
  TICK_RATE: 60, // 60 updates per second
  TICK_MS: 1000 / 60,
  
  // Grid settings
  CELL_SIZE: 50,
  CELL_SIZE_MOBILE: 40,
  
  // Zoom levels and labels
  ZOOM_LEVELS: [2.0, 1.0, 0.75] as const,
  ZOOM_LABELS: ['Low Risk', 'Medium', 'High Risk'] as const,
  
  // Grid speed based on volatility
  GRID_SPEED_ACTIVE: 2,
  GRID_SPEED_LOW: 0.5,
  GRID_SPEED_IDLE: 0.2,
  GRID_SPEED_MIN: 0.2,
  
  // Price visualization
  PRICE_SCALE: 8000,
  
  // Betting rules
  MIN_BET_COLUMNS_AHEAD: 6,         // Desktop: force bets further ahead
  MIN_BET_COLUMNS_AHEAD_MOBILE: 5,  // Mobile: fewer columns due to screen width
  BET_AMOUNT_OPTIONS: [10, 25, 50, 100] as const,
  BET_AMOUNT_OPTIONS_MOBILE: [1, 5, 10] as const,
  MAX_BET_AMOUNT: 100,
  MIN_BET_AMOUNT: 1,
  
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
  PRICE_AXIS_WIDTH: 80,
  PRICE_AXIS_WIDTH_MOBILE: 40,
  SIDEBAR_WIDTH: 56,
  SIDEBAR_WIDTH_MOBILE: 44,
  MOBILE_CAMERA_SCALE: 0.55,
  
  // Win zone margin - 0 means entire cell is win zone
  // Set to 0.15 (15%) to shrink hitbox for house edge
  WIN_ZONE_MARGIN: 0,  // FULL CELL = WIN ZONE (no margin)
  BET_AVOIDANCE_STRENGTH: 0.225,  // Matches client
  BET_AVOIDANCE_CAP: 0.45,        // Matches client
  
  // Price history
  MAX_PRICE_HISTORY: 5000,
  MAX_COLUMNS: 500,
} as const;

export type ServerConfig = typeof SERVER_CONFIG;

/**
 * Get client-facing config (excludes server-internal settings)
 * This is what gets sent to clients on connect
 */
export function getClientConfig() {
  return {
    // Grid
    cellSize: SERVER_CONFIG.CELL_SIZE,
    cellSizeMobile: SERVER_CONFIG.CELL_SIZE_MOBILE,
    
    // Zoom
    zoomLevels: SERVER_CONFIG.ZOOM_LEVELS,
    zoomLabels: SERVER_CONFIG.ZOOM_LABELS,
    
    // Grid speed
    gridSpeedActive: SERVER_CONFIG.GRID_SPEED_ACTIVE,
    gridSpeedLow: SERVER_CONFIG.GRID_SPEED_LOW,
    gridSpeedIdle: SERVER_CONFIG.GRID_SPEED_IDLE,
    gridSpeedMin: SERVER_CONFIG.GRID_SPEED_MIN,
    
    // Price
    priceScale: SERVER_CONFIG.PRICE_SCALE,
    priceSmoothing: SERVER_CONFIG.PRICE_SMOOTHING,
    flatlineThreshold: SERVER_CONFIG.FLATLINE_THRESHOLD,
    flatlineWindow: SERVER_CONFIG.FLATLINE_WINDOW,
    
    // Betting rules
    minBetColumnsAhead: SERVER_CONFIG.MIN_BET_COLUMNS_AHEAD,
    minBetColumnsAheadMobile: SERVER_CONFIG.MIN_BET_COLUMNS_AHEAD_MOBILE,
    betAmountOptions: SERVER_CONFIG.BET_AMOUNT_OPTIONS,
    betAmountOptionsMobile: SERVER_CONFIG.BET_AMOUNT_OPTIONS_MOBILE,
    maxBetAmount: SERVER_CONFIG.MAX_BET_AMOUNT,
    minBetAmount: SERVER_CONFIG.MIN_BET_AMOUNT,
    
    // House edge
    winZoneMargin: SERVER_CONFIG.WIN_ZONE_MARGIN,
    
    // Layout
    headX: SERVER_CONFIG.HEAD_X,
    headXMobile: SERVER_CONFIG.HEAD_X_MOBILE,
    verticalCells: SERVER_CONFIG.VERTICAL_CELLS,
    priceAxisWidth: SERVER_CONFIG.PRICE_AXIS_WIDTH,
    priceAxisWidthMobile: SERVER_CONFIG.PRICE_AXIS_WIDTH_MOBILE,
    sidebarWidth: SERVER_CONFIG.SIDEBAR_WIDTH,
    sidebarWidthMobile: SERVER_CONFIG.SIDEBAR_WIDTH_MOBILE,
    mobileCameraScale: SERVER_CONFIG.MOBILE_CAMERA_SCALE,
    
    // Server info
    tickRate: SERVER_CONFIG.TICK_RATE,
  };
}

export type ClientConfig = ReturnType<typeof getClientConfig>;

