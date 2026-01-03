/**
 * Game type definitions for the prediction market
 */

export interface Bet {
  id: string;           // Local ID for rendering
  serverId?: string;    // Server bet ID (for resolution)
  colId: string;
  yIndex: number;
  amount: number;
  multiplier: number;
  potentialWin: number;
  priceAtBet?: number;
  // Server-authoritative win boundaries (exact price range for a win)
  winPriceMin?: number; // Price must be >= this to win
  winPriceMax?: number; // Price must be <= this to win
  // Base price at bet time (for visual sync when rendering win boundaries)
  basePriceAtBet?: number;
  status: 'pending' | 'won' | 'lost' | 'placing' | 'error';
  resolving?: boolean;  // Flag to prevent duplicate resolution calls
}

export interface Column {
  id: string;
  x: number;
  cells: Record<number, { id: string; multiplier: string }>;
  centerIndex: number;
}

export interface GameState {
  offsetX: number;
  priceY: number;
  targetPriceY: number;
  priceHistory: Array<{ x: number; y: number }>;
  columns: Column[];
  bets: Bet[];
  lastGenX: number;
  cameraY: number;
  initialized: boolean;
  recentPrices: number[];
  currentSpeed: number;
  lastPrice: number | null;
}

export type VolatilityLevel = 'active' | 'low' | 'idle';

export interface GameConfig {
  cellSize: number;
  headX: number;
  priceAxisWidth: number;
  betOptions: number[];
}

