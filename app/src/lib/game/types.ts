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
  placedAt?: number;    // Timestamp when bet was placed (for animations)
  isSpecialBonus?: boolean; // Was placed on a special 2x cell
}

// Particle system for visual effects
export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;      // velocity X
  vy: number;      // velocity Y
  life: number;    // 0-1, decreases over time
  maxLife: number;
  size: number;
  color: string;
  type: 'sparkle' | 'confetti' | 'bubble' | 'trail';
  rotation?: number;
  rotationSpeed?: number;
}

export interface Column {
  id: string;
  x: number;
  cells: Record<number, { id: string; multiplier: string }>;
  centerIndex: number;
}

// Special golden cell with 2x payout bonus
export interface SpecialCell {
  id: string;
  colId: string;
  yIndex: number;
  createdAt: number;
  bonusMultiplier: number; // 2x additional multiplier
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
  particles: Particle[];
  specialCells: SpecialCell[];
  lastSpecialCellTime: number;
}

export type VolatilityLevel = 'active' | 'low' | 'idle';

export interface GameConfig {
  cellSize: number;
  headX: number;
  priceAxisWidth: number;
  betOptions: number[];
}

