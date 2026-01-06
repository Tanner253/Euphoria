/**
 * Server-Side Authoritative Game Engine
 * 
 * This is the SINGLE SOURCE OF TRUTH for all game state.
 * Clients receive state updates and render - they do NOT calculate state.
 */

import { SERVER_CONFIG } from './config.js';

// ============ TYPES ============

export interface PricePoint {
  x: number;  // World X coordinate
  y: number;  // Price Y position
}

export interface Column {
  id: string;
  x: number;  // World X position
  cells: Record<number, Cell>;
}

export interface Cell {
  id: string;
  multiplier: string;
}

export interface Bet {
  id: string;
  oddsIndex: number;
  oddsMultiplier: string;
  wager: number;
  payout: number;
  colId: string;
  yIndex: number;
  status: 'placing' | 'pending' | 'won' | 'lost' | 'expired';
  walletAddress: string;
  placedAt: number;
}

// Heatmap entry: tracks bet activity per cell
export interface HeatmapCell {
  colId: string;
  yIndex: number;
  betCount: number;      // Number of bets on this cell
  totalWagered: number;  // Total amount wagered
  heat: number;          // 0-1 normalized heat value
}

export interface GameState {
  // Core positioning
  priceY: number;           // Current smoothed price Y position
  targetPriceY: number;     // Target price Y (raw from price feed)
  offsetX: number;          // World scroll offset
  
  // Price data
  currentPrice: number | null;
  basePrice: number | null;
  priceHistory: PricePoint[];
  
  // Columns and cells
  columns: Column[];
  
  // Bets (all active bets from all players)
  bets: Bet[];
  
  // Heatmap: shows bet density across all cells
  heatmap: Map<string, HeatmapCell>;
  
  // Volatility
  volatility: 'active' | 'low' | 'idle';
  gridSpeed: number;
  
  // Timing
  lastUpdate: number;
  serverTime: number;
}

// ============ GAME ENGINE CLASS ============

export type BetResolvedCallback = (bet: Bet, won: boolean) => void;

export class GameEngine {
  private state: GameState;
  private priceBuffer: number[] = [];
  private lastTickTime: number = Date.now();
  private cellSize: number = SERVER_CONFIG.CELL_SIZE;
  private onBetResolved?: BetResolvedCallback;
  
  // === PRICE SMOOTHING STATE ===
  // Multi-layer smoothing to prevent rapid oscillations
  private smoothedPrice: number | null = null;      // EMA smoothed raw price
  private priceVelocity: number = 0;                // Current price movement velocity
  private lastPriceY: number = 0;                   // For velocity calculation
  private lastStableYIndex: number = 0;             // Last stable cell index (dead zone)
  
  constructor(onBetResolved?: BetResolvedCallback) {
    this.onBetResolved = onBetResolved;
    this.state = {
      priceY: this.cellSize / 2,
      targetPriceY: this.cellSize / 2,
      offsetX: 0,
      currentPrice: null,
      basePrice: null,
      priceHistory: [],
      columns: [],
      bets: [],
      heatmap: new Map(),
      volatility: 'idle',
      gridSpeed: SERVER_CONFIG.GRID_SPEED_IDLE,
      lastUpdate: Date.now(),
      serverTime: Date.now(),
    };
    
    // Initialize starting columns
    this.initializeColumns();
  }
  
  /**
   * Generate heatmap key for a cell
   */
  private getHeatmapKey(colId: string, yIndex: number): string {
    return `${colId}:${yIndex}`;
  }
  
  /**
   * Add bet to heatmap tracking
   */
  private addToHeatmap(bet: Bet): void {
    const key = this.getHeatmapKey(bet.colId, bet.yIndex);
    const existing = this.state.heatmap.get(key);
    
    if (existing) {
      existing.betCount++;
      existing.totalWagered += bet.wager;
    } else {
      this.state.heatmap.set(key, {
        colId: bet.colId,
        yIndex: bet.yIndex,
        betCount: 1,
        totalWagered: bet.wager,
        heat: 0,
      });
    }
    
    // Recalculate heat values
    this.recalculateHeat();
  }
  
  /**
   * Recalculate normalized heat values for all cells
   */
  private recalculateHeat(): void {
    let maxBets = 0;
    let maxWagered = 0;
    
    // Find max values
    for (const cell of this.state.heatmap.values()) {
      if (cell.betCount > maxBets) maxBets = cell.betCount;
      if (cell.totalWagered > maxWagered) maxWagered = cell.totalWagered;
    }
    
    // Normalize heat (weighted: 60% bet count, 40% wagered amount)
    for (const cell of this.state.heatmap.values()) {
      const countHeat = maxBets > 0 ? cell.betCount / maxBets : 0;
      const wageredHeat = maxWagered > 0 ? cell.totalWagered / maxWagered : 0;
      cell.heat = countHeat * 0.6 + wageredHeat * 0.4;
    }
  }
  
  /**
   * Clean up old heatmap entries for columns that no longer exist
   */
  private pruneHeatmap(): void {
    const columnIds = new Set(this.state.columns.map(c => c.id));
    
    for (const [key, cell] of this.state.heatmap.entries()) {
      if (!columnIds.has(cell.colId)) {
        this.state.heatmap.delete(key);
      }
    }
  }
  
  private initializeColumns(): void {
    const startX = -this.cellSize * 5;
    const endX = this.cellSize * 30;
    
    for (let x = startX; x <= endX; x += this.cellSize) {
      this.state.columns.push(this.createColumn(x));
    }
  }
  
  private createColumn(x: number): Column {
    const cells: Record<number, Cell> = {};
    const currentPriceYIndex = Math.floor(this.state.priceY / this.cellSize);
    
    // Generate cells around current price
    for (let i = -SERVER_CONFIG.VERTICAL_CELLS; i <= SERVER_CONFIG.VERTICAL_CELLS; i++) {
      const yIndex = currentPriceYIndex + i;
      cells[yIndex] = {
        id: this.generateId(),
        multiplier: this.calculateMultiplier(yIndex, currentPriceYIndex),
      };
    }
    
    return {
      id: this.generateId(),
      x,
      cells,
    };
  }
  
  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
  
  private calculateMultiplier(yIndex: number, currentPriceIndex: number, zoomLevel: number = 1.0): string {
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
  
  /**
   * Called when new price data arrives from the price feed
   */
  onPriceUpdate(price: number): void {
    this.priceBuffer.push(price);
    
    // Keep buffer small
    if (this.priceBuffer.length > 10) {
      this.priceBuffer.shift();
    }
  }
  
  /**
   * Main game tick - called at TICK_RATE (60fps)
   * Returns the authoritative game state to broadcast
   */
  tick(): GameState {
    const now = Date.now();
    const timeSinceLastTick = now - this.lastTickTime;
    this.lastTickTime = now;
    
    // Delta time normalization (target 16.67ms per frame)
    const deltaTime = Math.min(timeSinceLastTick, SERVER_CONFIG.TICK_MS * 3) / SERVER_CONFIG.TICK_MS;
    
    // Process price updates with AGGRESSIVE smoothing
    if (this.priceBuffer.length > 0) {
      // Average all buffered prices to reduce noise
      const avgPrice = this.priceBuffer.reduce((a, b) => a + b, 0) / this.priceBuffer.length;
      this.priceBuffer = [];
      
      if (this.state.basePrice === null) {
        // First price - initialize everything
        this.state.basePrice = avgPrice;
        this.state.currentPrice = avgPrice;
        this.smoothedPrice = avgPrice;
        this.state.targetPriceY = this.cellSize / 2;
        this.state.priceY = this.cellSize / 2;
      } else {
        // Apply DOUBLE EMA smoothing to raw price input
        // First pass: smooth the raw price
        if (this.smoothedPrice === null) {
          this.smoothedPrice = avgPrice;
        } else {
          const alpha = SERVER_CONFIG.PRICE_INPUT_SMOOTHING;
          // Double EMA for extra smoothing
          const firstSmooth = alpha * avgPrice + (1 - alpha) * this.smoothedPrice;
          this.smoothedPrice = alpha * firstSmooth + (1 - alpha) * this.smoothedPrice;
        }
        this.state.currentPrice = this.smoothedPrice;
      }
    }
    
    // Update game state if we have price data
    if (this.state.currentPrice !== null && this.state.basePrice !== null) {
      this.updatePhysics(deltaTime);
    }
    
    // Update timing
    this.state.lastUpdate = now;
    this.state.serverTime = now;
    
    return this.state;
  }
  
  private updatePhysics(deltaTime: number): void {
    const { currentPrice, basePrice } = this.state;
    if (currentPrice === null || basePrice === null) return;
    
    // Calculate volatility and grid speed
    this.state.gridSpeed = this.calculateVolatility();
    
    // Move world forward
    const pixelsPerTick = this.cellSize * this.state.gridSpeed * deltaTime / 60;
    this.state.offsetX += pixelsPerTick;
    
    // Generate new columns as needed
    this.generateColumns();
    
    // Clean up old columns
    this.pruneColumns();
    
    // Calculate raw target price Y from price delta
    const priceDelta = currentPrice - basePrice;
    const rawTargetY = -priceDelta * SERVER_CONFIG.PRICE_SCALE + this.cellSize / 2;
    
    // === DEAD ZONE: Prevent small oscillations ===
    // Only update target if movement exceeds dead zone threshold
    const targetDiff = rawTargetY - this.state.targetPriceY;
    if (Math.abs(targetDiff) > SERVER_CONFIG.PRICE_DEAD_ZONE) {
      this.state.targetPriceY = rawTargetY;
    }
    
    // === VELOCITY-BASED SMOOTH MOVEMENT ===
    // Calculate desired velocity towards target
    const diff = this.state.targetPriceY - this.state.priceY;
    const desiredVelocity = diff * SERVER_CONFIG.PRICE_SMOOTHING;
    
    // Apply heavy damping for smooth transitions (momentum)
    this.priceVelocity = this.priceVelocity * SERVER_CONFIG.PRICE_VELOCITY_DAMPING + 
                         desiredVelocity * (1 - SERVER_CONFIG.PRICE_VELOCITY_DAMPING);
    
    // Clamp maximum velocity to prevent sudden jumps
    const maxVel = SERVER_CONFIG.PRICE_MAX_VELOCITY;
    this.priceVelocity = Math.max(-maxVel, Math.min(maxVel, this.priceVelocity));
    
    // Apply velocity with time normalization
    this.state.priceY += this.priceVelocity * deltaTime;
    
    // Dampen velocity when very close to target (prevent oscillation)
    const currentDiff = Math.abs(this.state.targetPriceY - this.state.priceY);
    if (currentDiff < 3) {
      this.priceVelocity *= 0.7;
    }
    
    // Track for next frame
    this.lastPriceY = this.state.priceY;
    
    // Apply bet avoidance (house edge)
    this.applyBetAvoidance(deltaTime);
    
    // Update price history
    this.updatePriceHistory();
    
    // Resolve bets
    this.resolveBets();
  }
  
  private calculateVolatility(): number {
    // Simple volatility based on recent price movement
    if (this.state.priceHistory.length < 10) {
      return SERVER_CONFIG.GRID_SPEED_IDLE;
    }
    
    const recent = this.state.priceHistory.slice(-60);
    if (recent.length < 2) return SERVER_CONFIG.GRID_SPEED_IDLE;
    
    const yValues = recent.map(p => p.y);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const range = maxY - minY;
    
    // Normalize range to cell sizes
    const cellsRange = range / this.cellSize;
    
    if (cellsRange < 0.5) {
      this.state.volatility = 'idle';
      return SERVER_CONFIG.GRID_SPEED_IDLE;
    } else if (cellsRange < 2) {
      this.state.volatility = 'low';
      return SERVER_CONFIG.GRID_SPEED_LOW;
    } else {
      this.state.volatility = 'active';
      return SERVER_CONFIG.GRID_SPEED_ACTIVE;
    }
  }
  
  private generateColumns(): void {
    const headX = SERVER_CONFIG.HEAD_X;
    const currentWorldX = this.state.offsetX + headX;
    
    // Find rightmost column
    let maxX = -Infinity;
    for (const col of this.state.columns) {
      if (col.x > maxX) maxX = col.x;
    }
    
    // Generate columns ahead
    const targetX = currentWorldX + this.cellSize * 30;
    while (maxX < targetX) {
      maxX += this.cellSize;
      this.state.columns.push(this.createColumn(maxX));
    }
  }
  
  private pruneColumns(): void {
    const headX = SERVER_CONFIG.HEAD_X;
    const currentWorldX = this.state.offsetX + headX;
    const pruneThreshold = currentWorldX - this.cellSize * 20;
    
    // Remove columns that are too far behind (unless they have active bets)
    this.state.columns = this.state.columns.filter(col => {
      if (col.x > pruneThreshold) return true;
      
      // Keep if has active bet
      const hasBet = this.state.bets.some(
        b => b.colId === col.id && (b.status === 'pending' || b.status === 'placing')
      );
      return hasBet;
    });
    
    // Limit total columns
    if (this.state.columns.length > SERVER_CONFIG.MAX_COLUMNS) {
      // Sort by x position and keep the most recent
      this.state.columns.sort((a, b) => a.x - b.x);
      this.state.columns = this.state.columns.slice(-SERVER_CONFIG.MAX_COLUMNS);
    }
  }
  
  private applyBetAvoidance(deltaTime: number): void {
    const headX = SERVER_CONFIG.HEAD_X;
    const currentWorldX = this.state.offsetX + headX;
    
    let avoidanceForce = 0;
    
    for (const bet of this.state.bets) {
      if (bet.status !== 'pending' && bet.status !== 'placing') continue;
      
      const col = this.state.columns.find(c => c.id === bet.colId);
      if (!col) continue;
      
      // Only consider bets 1-4 columns ahead
      const columnsAhead = (col.x - currentWorldX) / this.cellSize;
      if (columnsAhead < 0.5 || columnsAhead > 4) continue;
      
      // Calculate vertical distance to bet cell
      const betCenterY = bet.yIndex * this.cellSize + this.cellSize / 2;
      const distY = this.state.priceY - betCenterY;
      const absDistY = Math.abs(distY);
      
      // Only apply avoidance if price is close to the bet
      if (absDistY < this.cellSize * 2) {
        const proximityFactor = 1 - (absDistY / (this.cellSize * 2));
        const distanceFactor = 1 - (columnsAhead / 4);
        const repulsionDir = distY > 0 ? 1 : -1;
        const forceStrength = proximityFactor * distanceFactor * this.cellSize * SERVER_CONFIG.BET_AVOIDANCE_STRENGTH;
        avoidanceForce += repulsionDir * forceStrength;
      }
    }
    
    // Cap avoidance force
    avoidanceForce = Math.max(
      -this.cellSize * SERVER_CONFIG.BET_AVOIDANCE_CAP,
      Math.min(this.cellSize * SERVER_CONFIG.BET_AVOIDANCE_CAP, avoidanceForce)
    );
    
    this.state.priceY += avoidanceForce * deltaTime;
  }
  
  private updatePriceHistory(): void {
    const headX = SERVER_CONFIG.HEAD_X;
    const currentWorldX = this.state.offsetX + headX;
    
    // Record points at configured interval for smoother curves
    const interval = SERVER_CONFIG.PRICE_HISTORY_INTERVAL;
    const lastPoint = this.state.priceHistory[this.state.priceHistory.length - 1];
    
    if (!lastPoint || currentWorldX - lastPoint.x >= interval) {
      this.state.priceHistory.push({ x: currentWorldX, y: this.state.priceY });
    }
    
    // Prune old history
    if (this.state.priceHistory.length > SERVER_CONFIG.MAX_PRICE_HISTORY) {
      this.state.priceHistory.shift();
    }
  }
  
  private resolveBets(): void {
    const headX = SERVER_CONFIG.HEAD_X;
    const currentWorldX = this.state.offsetX + headX;
    
    for (const bet of this.state.bets) {
      if (bet.status !== 'pending') continue;
      
      const col = this.state.columns.find(c => c.id === bet.colId);
      if (!col) continue;
      
      // Check if price line has fully crossed this column (past the right edge)
      const colEndX = col.x + this.cellSize;
      if (currentWorldX > colEndX) {
        // Find the Y range the price line traveled through while in this column
        // This allows wins when price TOUCHED the cell at ANY point
        const colStartX = col.x;
        let minY = Infinity;
        let maxY = -Infinity;
        
        for (let i = 0; i < this.state.priceHistory.length - 1; i++) {
          const p1 = this.state.priceHistory[i];
          const p2 = this.state.priceHistory[i + 1];
          
          // Check if this segment overlaps with the column
          if (p2.x < colStartX || p1.x > colEndX) continue;
          
          // Get Y values at the boundaries of overlap
          const segStartX = Math.max(p1.x, colStartX);
          const segEndX = Math.min(p2.x, colEndX);
          
          // Interpolate Y at segment boundaries
          const getYAt = (x: number) => {
            if (p2.x === p1.x) return p1.y;
            const t = (x - p1.x) / (p2.x - p1.x);
            return p1.y + t * (p2.y - p1.y);
          };
          
          const y1 = getYAt(segStartX);
          const y2 = getYAt(segEndX);
          
          minY = Math.min(minY, y1, y2);
          maxY = Math.max(maxY, y1, y2);
        }
        
        // If no price history found for this column, use current priceY as fallback
        if (minY === Infinity) {
          minY = this.state.priceY;
          maxY = this.state.priceY;
        }
        
        // Win zone check: did the price Y range overlap with the bet cell?
        // Cell spans from (yIndex * cellSize) to ((yIndex + 1) * cellSize)
        // Win zone is shrunk by margin on each side
        const margin = this.cellSize * SERVER_CONFIG.WIN_ZONE_MARGIN;
        const cellTopY = bet.yIndex * this.cellSize + margin;
        const cellBottomY = (bet.yIndex + 1) * this.cellSize - margin;
        
        // Win if price range overlaps with cell's win zone
        const won = minY < cellBottomY && maxY > cellTopY;
        bet.status = won ? 'won' : 'lost';
        
        // Emit bet resolved callback
        if (this.onBetResolved) {
          this.onBetResolved(bet, won);
        }
      }
    }
  }
  
  /**
   * Place a bet (called from Socket handler)
   * colId is the column's world X position from the client
   */
  placeBet(bet: Omit<Bet, 'status' | 'placedAt'>): Bet | null {
    // Parse X position from colId
    const targetX = parseFloat(bet.colId);
    if (isNaN(targetX)) return null;
    
    // Snap to grid
    const snappedX = Math.round(targetX / this.cellSize) * this.cellSize;
    
    // Find or create column at this position
    let column = this.state.columns.find(c => c.x === snappedX);
    
    if (!column) {
      // Create the column dynamically
      column = this.createColumn(snappedX);
      this.state.columns.push(column);
      // Sort columns by x position
      this.state.columns.sort((a, b) => a.x - b.x);
    }
    
    // Create the bet
    const fullBet: Bet = {
      ...bet,
      colId: column.id,
      status: 'pending',
      placedAt: Date.now(),
    };
    
    this.state.bets.push(fullBet);
    this.addToHeatmap(fullBet);
    
    return fullBet;
  }
  
  /**
   * Get compact state for broadcasting (omit unnecessary data)
   */
  getCompactState(): object {
    // Prune old heatmap entries
    this.pruneHeatmap();
    
    // Convert heatmap to array for visible columns only
    const visibleColIds = new Set(this.getVisibleColumns().map(c => c.id));
    const heatmapArray: HeatmapCell[] = [];
    
    for (const cell of this.state.heatmap.values()) {
      if (visibleColIds.has(cell.colId) && cell.heat > 0.05) {
        heatmapArray.push(cell);
      }
    }
    
    return {
      priceY: Math.round(this.state.priceY * 100) / 100,
      targetPriceY: Math.round(this.state.targetPriceY * 100) / 100,
      offsetX: Math.round(this.state.offsetX * 100) / 100,
      currentPrice: this.state.currentPrice,
      volatility: this.state.volatility,
      gridSpeed: this.state.gridSpeed,
      serverTime: this.state.serverTime,
      // Send recent price history only
      priceHistory: this.state.priceHistory.slice(-500),
      // Send columns that are visible
      columns: this.getVisibleColumns(),
      // Send active bets only
      bets: this.state.bets.filter(b => b.status === 'pending' || b.status === 'placing'),
      // Send heatmap for visible cells
      heatmap: heatmapArray,
    };
  }
  
  private getVisibleColumns(): Column[] {
    const headX = SERVER_CONFIG.HEAD_X;
    const currentWorldX = this.state.offsetX + headX;
    const minX = currentWorldX - this.cellSize * 15;
    const maxX = currentWorldX + this.cellSize * 35;
    
    return this.state.columns.filter(col => col.x >= minX && col.x <= maxX);
  }
  
  /**
   * Get full state (for debugging)
   */
  getFullState(): GameState {
    return { ...this.state };
  }
  
  /**
   * Sync offsetX with a client's position (for when clients are ahead)
   */
  syncOffsetX(clientOffsetX: number): void {
    if (clientOffsetX > this.state.offsetX) {
      this.state.offsetX = clientOffsetX;
      // Generate columns for the new position
      this.generateColumns();
    }
  }
}

