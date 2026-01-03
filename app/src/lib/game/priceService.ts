/**
 * Server-side price service
 * Maintains authoritative price state for bet resolution
 */

interface PricePoint {
  price: number;
  timestamp: number;
  worldX: number;
}

interface PriceServiceState {
  currentPrice: number | null;
  basePrice: number | null; // Price when game session started
  priceHistory: PricePoint[];
  worldX: number; // Current world X position
  lastUpdate: number;
  isConnected: boolean;
}

// In-memory state (in production, use Redis or similar)
const state: PriceServiceState = {
  currentPrice: null,
  basePrice: null,
  priceHistory: [],
  worldX: 0,
  lastUpdate: 0,
  isConnected: false,
};

// WebSocket connection (server-side)
let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;

const PRICE_HISTORY_MAX = 10000;
const GRID_SPEED = 1; // pixels per frame
const TARGET_FPS = 60;
const MS_PER_FRAME = 1000 / TARGET_FPS;

/**
 * Initialize price service (call once on server startup)
 */
export function initPriceService() {
  if (typeof window !== 'undefined') {
    console.warn('Price service should only run on server');
    return;
  }
  
  connectWebSocket();
  startWorldXUpdater();
}

function connectWebSocket() {
  try {
    // Dynamic import for server-side WebSocket
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WebSocket = require('ws');
    
    const socket = new WebSocket('wss://stream.binance.com:9443/ws/solusdt@trade');
    ws = socket;
    
    socket.on('open', () => {
      console.log('[PriceService] Connected to Binance');
      state.isConnected = true;
    });
    
    socket.on('message', (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.p) {
          const price = parseFloat(parsed.p);
          const now = Date.now();
          
          // Set base price on first update
          if (state.basePrice === null) {
            state.basePrice = price;
          }
          
          state.currentPrice = price;
          state.lastUpdate = now;
          
          // Record history
          state.priceHistory.push({
            price,
            timestamp: now,
            worldX: state.worldX,
          });
          
          // Prune old history
          if (state.priceHistory.length > PRICE_HISTORY_MAX) {
            state.priceHistory.shift();
          }
        }
      } catch (e) {
        console.error('[PriceService] Parse error:', e);
      }
    });
    
    socket.on('close', () => {
      console.log('[PriceService] WebSocket closed, reconnecting...');
      state.isConnected = false;
      reconnectTimeout = setTimeout(connectWebSocket, 2000);
    });
    
    socket.on('error', (err: Error) => {
      console.error('[PriceService] WebSocket error:', err);
    });
  } catch (e) {
    console.error('[PriceService] Failed to connect:', e);
    reconnectTimeout = setTimeout(connectWebSocket, 5000);
  }
}

function startWorldXUpdater() {
  // Update worldX based on elapsed time
  let lastTick = Date.now();
  
  setInterval(() => {
    const now = Date.now();
    const elapsed = now - lastTick;
    const frames = elapsed / MS_PER_FRAME;
    
    state.worldX += GRID_SPEED * frames;
    lastTick = now;
  }, 100); // Update every 100ms
}

/**
 * Get current authoritative game state
 */
export function getGameState() {
  return {
    currentPrice: state.currentPrice,
    basePrice: state.basePrice,
    worldX: state.worldX,
    lastUpdate: state.lastUpdate,
    isConnected: state.isConnected,
  };
}

/**
 * Get price at a specific worldX (for bet resolution)
 * Returns null if price data not available for that position
 */
export function getPriceAtWorldX(targetWorldX: number): number | null {
  // Find the price point closest to the target worldX
  let closest: PricePoint | null = null;
  let minDiff = Infinity;
  
  for (const point of state.priceHistory) {
    const diff = Math.abs(point.worldX - targetWorldX);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  }
  
  // Only return if we have a reasonably close match (within 100 worldX units)
  if (closest && minDiff < 100) {
    return closest.price;
  }
  
  return null;
}

/**
 * Check if a bet should be resolved
 */
export function shouldResolveBet(betWorldX: number): boolean {
  return state.worldX >= betWorldX;
}

/**
 * Clean up price service
 */
export function closePriceService() {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

