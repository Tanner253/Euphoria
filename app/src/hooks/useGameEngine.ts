'use client';

/**
 * useGameEngine - Core game logic hook for the prediction market
 * 
 * SERVER-AUTHORITATIVE: All bet placement and resolution goes through server APIs
 * The client is only responsible for rendering - never trusted for balance/outcomes
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { GAME_CONFIG, calculateMultiplier } from '@/lib/game/gameConfig';
import { getGameSounds } from '@/lib/audio/GameSounds';
import { gameAPI } from '@/lib/services/GameAPI';
import type { Bet, Column, GameState, VolatilityLevel } from '@/lib/game/types';

interface UseGameEngineOptions {
  isMobile: boolean;
  balance: number;
  betAmount: number;
  sessionId: string;  // Game session ID for bet tracking
  isAuthenticated: boolean;  // Whether user is authenticated
  sidebarWidth?: number;  // Width of left sidebar to offset canvas
  onBalanceChange: (newBalance: number) => void;  // Server-provided balance updates only
  onWin: (winInfo: { amount: number; id: string }) => void;
  onTotalWonChange: (updater: (prev: number) => number) => void;
  onTotalLostChange: (updater: (prev: number) => number) => void;
  onError?: (error: string) => void;  // Error callback for bet failures
}

interface UseGameEngineReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  volatilityLevel: VolatilityLevel;
  handlePointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: () => void;
  handlePointerLeave: () => void;
  isDragging: boolean;
  updatePrice: (price: number | null) => void;
  pendingBetsCount: number;
  zoomLevel: number;
  zoomIndex: number;
  cycleZoom: () => void;
  zoomLocked: boolean; // True when zoom is disabled due to active bets
}

export function useGameEngine({
  isMobile,
  balance,
  betAmount,
  sessionId,
  isAuthenticated,
  sidebarWidth = 56,
  onBalanceChange,
  onWin,
  onTotalWonChange,
  onTotalLostChange,
  onError,
}: UseGameEngineOptions): UseGameEngineReturn {
  const [volatilityLevel, setVolatilityLevel] = useState<VolatilityLevel>('active');
  const [isDragging, setIsDragging] = useState(false);
  const [pendingBetsCount, setPendingBetsCount] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(0);
  const zoomLevel = GAME_CONFIG.ZOOM_LEVELS[zoomIndex];
  
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const requestRef = useRef<number | null>(null);
  const basePriceRef = useRef<number | null>(null);
  const priceRef = useRef<number | null>(null);
  const balanceRef = useRef(balance);
  const betAmountRef = useRef(betAmount);
  const lastBetCellRef = useRef<string | null>(null);
  const sessionIdRef = useRef(sessionId);
  
  // Track pending bet amounts to prevent overbetting during rapid clicks
  const pendingBetAmountRef = useRef<number>(0);
  
  // DRAG MODE BATCHING: Queue bets during drag, send all at once on release
  interface QueuedBet {
    localId: string;
    columnId: string;
    yIndex: number;
    basePrice: number;
    cellSize: number;
    amount: number;
    multiplier: number;
  }
  const dragBetQueueRef = useRef<QueuedBet[]>([]);
  const isDraggingRef = useRef(false);
  
  const stateRef = useRef<GameState>({
    offsetX: 0,
    priceY: 0,
    targetPriceY: 0,
    priceHistory: [],
    columns: [],
    bets: [],
    lastGenX: 0,
    cameraY: 0,
    initialized: false,
    recentPrices: [],
    currentSpeed: GAME_CONFIG.GRID_SPEED_ACTIVE,
    lastPrice: null,
  });
  
  // Track tab visibility to handle price jumps smoothly
  const lastFrameTimeRef = useRef<number>(Date.now());
  const wasHiddenRef = useRef<boolean>(false);
  
  // Hover and animation state
  const hoverCellRef = useRef<{ colId: string; yIndex: number } | null>(null);
  const mouseWorldPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // Win animation particles
  interface WinParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    color: string;
    size: number;
  }
  const winParticlesRef = useRef<WinParticle[]>([]);
  
  // Win celebration pulse effect
  interface WinPulse {
    x: number;
    y: number;
    radius: number;
    maxRadius: number;
    alpha: number;
  }
  const winPulsesRef = useRef<WinPulse[]>([]);

  // Keep refs in sync
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { betAmountRef.current = betAmount; }, [betAmount]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  
  // Update pending bets count
  useEffect(() => {
    const count = stateRef.current.bets.filter(b => b.status === 'pending' || b.status === 'placing').length;
    setPendingBetsCount(count);
  }, []);
  
  // Track previous zoom index to detect actual changes (not initial mount)
  const prevZoomIndexRef = useRef<number | null>(null);
  
  // REDRAW ENTIRE GRID when zoom changes (but NOT on initial mount)
  useEffect(() => {
    // Skip on initial mount - let the main initialization handle it
    if (prevZoomIndexRef.current === null) {
      prevZoomIndexRef.current = zoomIndex;
      return;
    }
    
    // Only run if zoom actually changed
    if (prevZoomIndexRef.current === zoomIndex) return;
    prevZoomIndexRef.current = zoomIndex;
    
    const state = stateRef.current;
    if (!state.initialized) return;
    
    const cellSize = Math.floor((isMobile ? GAME_CONFIG.CELL_SIZE_MOBILE : GAME_CONFIG.CELL_SIZE) * zoomLevel);
    const headX = isMobile ? GAME_CONFIG.HEAD_X_MOBILE : GAME_CONFIG.HEAD_X;
    
    // Clear columns and reset grid
    state.columns = [];
    state.lastGenX = 0;
    state.offsetX = 0;
    state.priceY = cellSize / 2;
    state.targetPriceY = cellSize / 2;
    state.priceHistory = [{ x: headX, y: cellSize / 2 }];
    state.cameraY = window.innerHeight / 2;
    
    // Regenerate columns with proper cells using generateColumn pattern
    const priceY = cellSize / 2;
    for (let x = 0; x < window.innerWidth + 600; x += cellSize) {
      const centerYIndex = Math.floor(priceY / cellSize);
      const newCol: Column = {
        id: Math.random().toString(36).substr(2, 9),
        x,
        cells: {},
        centerIndex: centerYIndex,
      };
      
      // Populate cells around center (same pattern as generateColumn)
      for (let j = -15; j <= 15; j++) {
        const yIndex = centerYIndex + j;
        newCol.cells[yIndex] = {
          id: Math.random().toString(36).substr(2, 9),
          multiplier: '1.10', // Placeholder - actual multiplier calculated dynamically during render
        };
      }
      
      state.columns.push(newCol);
      state.lastGenX = x;
    }
    
    console.log('[Zoom] Grid redrawn at zoom level', zoomLevel);
  }, [zoomIndex, isMobile, zoomLevel]);

  // Get responsive config values with zoom applied
  const getCellSize = useCallback(() => {
    const baseSize = isMobile ? GAME_CONFIG.CELL_SIZE_MOBILE : GAME_CONFIG.CELL_SIZE;
    return Math.floor(baseSize * zoomLevel);
  }, [isMobile, zoomLevel]);
  const getHeadX = useCallback(() => isMobile ? GAME_CONFIG.HEAD_X_MOBILE : GAME_CONFIG.HEAD_X, [isMobile]);
  const getPriceAxisWidth = useCallback(() => isMobile ? GAME_CONFIG.PRICE_AXIS_WIDTH_MOBILE : GAME_CONFIG.PRICE_AXIS_WIDTH, [isMobile]);

  const generateColumn = useCallback((xPosition: number, currentPriceY: number) => {
    const state = stateRef.current;
    const cellSize = getCellSize();
    const currentPriceIndex = Math.floor((currentPriceY + cellSize / 2) / cellSize);
    
    const cells: Record<number, { id: string; multiplier: string }> = {};
    for (let i = -GAME_CONFIG.VERTICAL_CELLS; i <= GAME_CONFIG.VERTICAL_CELLS; i++) {
      const yIndex = currentPriceIndex + i;
      cells[yIndex] = {
        id: Math.random().toString(36).substr(2, 9),
        multiplier: calculateMultiplier(yIndex, currentPriceIndex),
      };
    }

    state.columns.push({
      id: Math.random().toString(36).substr(2, 9),
      x: xPosition,
      cells,
      centerIndex: currentPriceIndex,
    });
    
    if (state.columns.length > 100) {
      state.columns.shift();
    }
    
    state.lastGenX = xPosition;
  }, [getCellSize]);

  const playSound = useCallback((type: 'win' | 'click' | 'lose') => {
    const sounds = getGameSounds();
    switch (type) {
      case 'win':
        sounds.play('win');
        break;
      case 'click':
        sounds.play('bet');
        break;
      case 'lose':
        sounds.play('loss');
        break;
    }
  }, []);

  const placeBetAt = useCallback(async (screenX: number, screenY: number, allowDuplicate = false) => {
    const currentBalance = balanceRef.current;
    const currentBetAmount = betAmountRef.current;
    const cellSize = getCellSize();
    const headX = getHeadX();
    const priceAxisWidth = getPriceAxisWidth();
    
    // Client-side pre-check (balance is already deducted optimistically for pending bets)
    if (currentBalance < currentBetAmount) {
      onError?.('Insufficient balance');
      return false;
    }
    if (screenX > window.innerWidth - priceAxisWidth) return false;
    
    const state = stateRef.current;
    const worldX = screenX + state.offsetX;
    const worldY = screenY - state.cameraY;
    
    const clickedCol = state.columns.find(c => worldX >= c.x && worldX < c.x + cellSize);
    
    if (clickedCol) {
      const yIndex = Math.floor(worldY / cellSize);
      const minBetX = state.offsetX + headX + cellSize * GAME_CONFIG.MIN_BET_COLUMNS_AHEAD;
      
      if (clickedCol.x > minBetX) {
        const cellKey = `${clickedCol.id}-${yIndex}`;
        if (!allowDuplicate && lastBetCellRef.current === cellKey) {
          return false;
        }
        
        // Check for existing bet at this location
        const existingBet = state.bets.find(
          b => b.colId === clickedCol.id && b.yIndex === yIndex && 
               (b.status === 'pending' || b.status === 'placing')
        );
        if (existingBet) return false;
        
        lastBetCellRef.current = cellKey;
        playSound('click');
        
        // Ensure cell exists in column
        let cell = clickedCol.cells[yIndex];
        if (!cell) {
          cell = {
            id: Math.random().toString(36).substr(2, 9),
            multiplier: '1.10', // Placeholder - actual multiplier calculated dynamically
          };
          clickedCol.cells[yIndex] = cell;
        }

        // DYNAMIC MULTIPLIER: Calculate based on CURRENT price position at time of bet
        // Note: priceY is the Y coordinate of the price line, cellSize is the cell height
        // To find which cell index the price is in: floor(priceY / cellSize)
        const currentPriceYIndex = Math.floor(stateRef.current.priceY / cellSize);
        const dynamicMultiplier = calculateMultiplier(yIndex, currentPriceYIndex);
        const multiplier = parseFloat(dynamicMultiplier);
        const localBetId = Math.random().toString(36).substr(2, 9);
        
        // Create bet - demo mode goes straight to pending, authenticated waits for server
        // Store basePriceAtBet so win zone visualization stays aligned with bet cell
        const newBet: Bet = {
          id: localBetId,
          colId: clickedCol.id,
          yIndex,
          amount: currentBetAmount,
          multiplier,
          potentialWin: currentBetAmount * multiplier,
          status: isAuthenticated ? 'placing' : 'pending',
          basePriceAtBet: basePriceRef.current ?? undefined,
        };
        
        state.bets.push(newBet);
        setPendingBetsCount(prev => prev + 1);
        
        // IMMEDIATELY deduct balance (optimistic update for instant feedback)
        const newBalance = currentBalance - currentBetAmount;
        balanceRef.current = newBalance;
        onBalanceChange(newBalance);
        
        // DEMO MODE: Done - no server call needed
        if (!isAuthenticated) {
          return true;
        }
        
        // AUTHENTICATED: Track pending amount in case server rejects
        pendingBetAmountRef.current += currentBetAmount;
        
        // AUTHENTICATED: Server-authoritative betting
        const basePrice = basePriceRef.current ?? 0;
        
        // DRAG MODE BATCHING: Queue bet if dragging, send later
        if (isDraggingRef.current) {
          dragBetQueueRef.current.push({
            localId: localBetId,
            columnId: clickedCol.id,
            yIndex,
            basePrice,
            cellSize,
            amount: currentBetAmount,
            multiplier,
          });
          return true; // Bet queued, will be sent on drag end
        }
        
        // SINGLE BET: Send immediately
        try {
          const result = await gameAPI.placeBet({
            sessionId: sessionIdRef.current,
            columnId: clickedCol.id,
            yIndex,
            basePrice,
            cellSize,
            amount: currentBetAmount,
            multiplier,
          });
          
          if (result.success && result.bet) {
            // Update bet with server data (including win boundaries)
            const bet = state.bets.find(b => b.id === localBetId);
            if (bet) {
              bet.serverId = result.bet.id;
              bet.status = 'pending';
              bet.priceAtBet = result.bet.priceAtBet;
              // Store server-calculated win boundaries for visualization
              bet.winPriceMin = result.bet.winPriceMin;
              bet.winPriceMax = result.bet.winPriceMax;
            }
            
            // Server confirmed - clear pending tracking
            pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - currentBetAmount);
            // DON'T overwrite balance here - optimistic deduction is already correct
            // Only sync balance after ALL pending bets are resolved to avoid race conditions
            // The server balance will be synced when wins/losses are processed
          } else {
            // Bet REJECTED by server - REFUND the optimistic deduction
            const betIndex = state.bets.findIndex(b => b.id === localBetId);
            if (betIndex !== -1) {
              state.bets.splice(betIndex, 1);
            }
            
            // Refund: add the bet amount back
            pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - currentBetAmount);
            balanceRef.current += currentBetAmount;
            onBalanceChange(balanceRef.current);
            
            onError?.(result.error || 'Failed to place bet');
            playSound('lose');
            setPendingBetsCount(prev => Math.max(0, prev - 1));
            return false;
          }
        } catch (error) {
          // Network error - REFUND the optimistic deduction
          const betIndex = state.bets.findIndex(b => b.id === localBetId);
          if (betIndex !== -1) {
            state.bets.splice(betIndex, 1);
          }
          
          // Refund: add the bet amount back
          pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - currentBetAmount);
          balanceRef.current += currentBetAmount;
          onBalanceChange(balanceRef.current);
          
          onError?.('Network error - please try again');
          setPendingBetsCount(prev => Math.max(0, prev - 1));
          return false;
        }
        
        return true;
      }
    }
    return false;
  }, [isAuthenticated, playSound, getCellSize, getHeadX, getPriceAxisWidth, onBalanceChange, onError]);

  const updatePrice = useCallback((price: number | null) => {
    if (price !== null) {
      priceRef.current = price;
    }
  }, []);

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cellSize = getCellSize();
    const headX = getHeadX();
    const priceAxisWidth = getPriceAxisWidth();

    // SERVER-AUTHORITATIVE: Resolve bets through API
    const checkBets = async (currentHeadX: number, headY: number) => {
      const state = stateRef.current;
      
      for (const bet of state.bets) {
        // Only process pending bets that aren't already resolving
        if (bet.status !== 'pending' || bet.resolving) continue;

        const col = state.columns.find(c => c.id === bet.colId);
        if (!col) {
          // Column no longer exists - loss
          bet.status = 'lost';
          onTotalLostChange(prev => prev + bet.amount);
          playSound('lose');
          setPendingBetsCount(prev => Math.max(0, prev - 1));
          continue;
        }

        const betEndX = col.x + cellSize;
        
        // When price line passes the bet column, resolve the bet
        if (currentHeadX > betEndX) {
          // Helper to get Y at a specific X from price history
          const getYAtX = (targetX: number): number | null => {
            for (let i = 0; i < state.priceHistory.length - 1; i++) {
              const p1 = state.priceHistory[i];
              const p2 = state.priceHistory[i + 1];
              
              if (p1.x <= targetX && p2.x >= targetX) {
                if (p2.x === p1.x) return p1.y;
                const t = (targetX - p1.x) / (p2.x - p1.x);
                return p1.y + t * (p2.y - p1.y);
              }
            }
            return null;
          };
          
          // Check Y at column center for resolution
          const colCenter = col.x + cellSize / 2;
          const yAtCenter = getYAtX(colCenter);
          const priceYAtCrossing = yAtCenter ?? headY;
          
          // SIMPLE GRID-BASED WIN DETECTION
          // Check if the price line Y falls within the bet's cell
          // This is the SAME logic for both authenticated and demo bets
          const priceYIndex = Math.floor(priceYAtCrossing / cellSize);
          const isWin = priceYIndex === bet.yIndex;
          
          // DEMO MODE: Resolve client-side
          if (!bet.serverId) {
            bet.status = isWin ? 'won' : 'lost';
            
            if (isWin) {
              const winAmount = bet.amount * bet.multiplier;
              onBalanceChange(balanceRef.current + winAmount);
              balanceRef.current += winAmount;
              onTotalWonChange(prev => prev + winAmount - bet.amount);
              onWin({ amount: winAmount, id: bet.id });
              playSound('win');
            } else {
              onTotalLostChange(prev => prev + bet.amount);
              playSound('lose');
            }
            setPendingBetsCount(prev => Math.max(0, prev - 1));
            continue;
          }
          
          // AUTHENTICATED: Resolve on server
          bet.resolving = true;
          // Calculate the price at crossing using the SAME basePrice from bet time
          // This ensures server and client use the same reference point
          const resolveBasePrice = bet.basePriceAtBet ?? basePriceRef.current ?? 0;
          const priceAtCrossing = resolveBasePrice + (cellSize / 2 - priceYAtCrossing) / GAME_CONFIG.PRICE_SCALE;
          resolveBetOnServer(bet, isWin, priceAtCrossing);
        }
      }
    };
    
    // Resolve bet on server (async, non-blocking)
    const resolveBetOnServer = async (bet: Bet, clientHint: boolean, priceAtCrossing: number) => {
      if (!bet.serverId) return;
      
      try {
        // Send the price at the moment the column crossed the head
        // Server validates this price is reasonable and uses it for win determination
        const result = await gameAPI.resolveBet(bet.serverId, clientHint, priceAtCrossing);
        
        if (result.success && result.bet) {
          const serverBet = result.bet;
          bet.status = serverBet.status as 'won' | 'lost';
          
          if (serverBet.status === 'won') {
            // Server says WIN - update from server data
            const winAmount = serverBet.actualWin;
            onTotalWonChange(prev => prev + winAmount - bet.amount);
            onWin({ amount: winAmount, id: bet.id });
            playSound('win');
            
            // Refresh balance from server
            const balanceData = await gameAPI.getBalance();
            if (balanceData?.user) {
              onBalanceChange(balanceData.user.gemsBalance);
              balanceRef.current = balanceData.user.gemsBalance;
            }
          } else {
            // Server says LOSS
            onTotalLostChange(prev => prev + bet.amount);
            playSound('lose');
          }
          
          setPendingBetsCount(prev => Math.max(0, prev - 1));
        }
      } catch (error) {
        // Network error - keep bet as pending, will retry
        bet.resolving = false;
        console.error('Failed to resolve bet:', error);
      }
    };

    const calculateVolatility = (currentPrice: number): number => {
      const state = stateRef.current;
      
      state.recentPrices.push(currentPrice);
      if (state.recentPrices.length > GAME_CONFIG.FLATLINE_WINDOW) {
        state.recentPrices.shift();
      }
      
      if (state.recentPrices.length < 10) {
        return GAME_CONFIG.GRID_SPEED_ACTIVE;
      }
      
      const minPrice = Math.min(...state.recentPrices);
      const maxPrice = Math.max(...state.recentPrices);
      const priceRange = maxPrice - minPrice;
      
      if (priceRange < GAME_CONFIG.FLATLINE_THRESHOLD * 0.5) {
        setVolatilityLevel('idle');
        return GAME_CONFIG.GRID_SPEED_IDLE;
      } else if (priceRange < GAME_CONFIG.FLATLINE_THRESHOLD) {
        setVolatilityLevel('low');
        return GAME_CONFIG.GRID_SPEED_IDLE * 3;
      } else {
        setVolatilityLevel('active');
        const volatilityMultiplier = Math.min(priceRange / 0.01, 1);
        return GAME_CONFIG.GRID_SPEED_IDLE + (GAME_CONFIG.GRID_SPEED_ACTIVE - GAME_CONFIG.GRID_SPEED_IDLE) * volatilityMultiplier;
      }
    };

    const updatePhysics = () => {
      const currentPrice = priceRef.current;
      if (currentPrice === null) return;
      
      const state = stateRef.current;
      const width = canvas.width;
      const now = Date.now();
      const timeSinceLastFrame = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      if (basePriceRef.current === null) {
        basePriceRef.current = currentPrice;
        state.lastPrice = currentPrice;
        state.priceY = cellSize / 2;
        state.targetPriceY = cellSize / 2;
      }

      // Detect if we're returning from a hidden tab (frame gap > 500ms)
      const wasTabHidden = timeSinceLastFrame > 500;
      
      // Check if there are active bets - if so, DON'T reset basePrice
      // This prevents the coordinate system from shifting under active bets
      const hasActiveBets = state.bets.some(b => b.status === 'pending' || b.status === 'placing');
      
      if (wasTabHidden && !hasActiveBets) {
        // Tab was hidden and NO active bets - safe to snap to current price
        // This prevents manipulation and visual spikes
        basePriceRef.current = currentPrice;
        state.priceY = cellSize / 2;
        state.targetPriceY = cellSize / 2;
        state.recentPrices = []; // Reset volatility calculation
        state.lastPrice = currentPrice;
        
        // Clear the price history gap
        const lastPoint = state.priceHistory[state.priceHistory.length - 1];
        if (lastPoint) {
          // Add a gap marker or just continue from current position
          state.priceHistory.push({ x: state.offsetX + headX, y: state.priceY });
        }
      } else if (wasTabHidden && hasActiveBets) {
        // Tab was hidden but we have active bets - DON'T reset basePrice
        // Just reset volatility and continue from where we were
        state.recentPrices = [];
        // Let the price smoothly catch up instead of jumping
      }

      const targetSpeed = calculateVolatility(currentPrice);
      state.currentSpeed += (targetSpeed - state.currentSpeed) * 0.02;
      state.offsetX += state.currentSpeed;

      const rightEdge = state.offsetX + width;
      if (state.lastGenX < rightEdge + cellSize * 2) {
        generateColumn(state.lastGenX + cellSize, state.priceY);
      }

      const priceDelta = currentPrice - basePriceRef.current;
      state.targetPriceY = -priceDelta * GAME_CONFIG.PRICE_SCALE + cellSize / 2;
      
      // Use faster smoothing if the gap is large (catch up quicker)
      const diff = state.targetPriceY - state.priceY;
      const smoothing = Math.abs(diff) > cellSize * 3 
        ? 0.3  // Fast catch-up for large gaps
        : GAME_CONFIG.PRICE_SMOOTHING;
      state.priceY += diff * smoothing;
      
      const currentWorldX = state.offsetX + headX;
      
      const lastPoint = state.priceHistory[state.priceHistory.length - 1];
      if (!lastPoint || currentWorldX - lastPoint.x > 0.5) {
        state.priceHistory.push({ x: currentWorldX, y: state.priceY });
      }
      
      if (state.priceHistory.length > 5000) {
        state.priceHistory.shift();
      }

      const height = canvas.height;
      const targetCameraY = -state.priceY + height / 2;
      state.cameraY += (targetCameraY - state.cameraY) * 0.02;

      state.lastPrice = currentPrice;
      checkBets(currentWorldX, state.priceY);
    };

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const width = canvas.width;
      const height = canvas.height;
      const state = stateRef.current;
      const currentPrice = priceRef.current ?? basePriceRef.current ?? 0;

      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#12001f');
      gradient.addColorStop(0.5, GAME_CONFIG.BG_COLOR);
      gradient.addColorStop(1, '#08000f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(0, state.cameraY);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${isMobile ? 8 : 10}px "JetBrains Mono", "SF Mono", monospace`;
      
      const startColIndex = state.columns.findIndex(c => c.x + cellSize > state.offsetX);
      const currentHeadX = state.offsetX + headX;
      
      // DYNAMIC MULTIPLIERS: Calculate current price's Y index for multiplier calculation
      // priceY is where the price line is drawn, divide by cellSize to get cell index
      const currentPriceYIndex = Math.floor(state.priceY / cellSize);
      
      for (let i = Math.max(0, startColIndex); i < state.columns.length; i++) {
        const col = state.columns[i];
        const screenX = col.x - state.offsetX;
        
        if (screenX > width - priceAxisWidth) break;

        ctx.strokeStyle = GAME_CONFIG.GRID_LINE_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(screenX, -8000);
        ctx.lineTo(screenX, 8000);
        ctx.stroke();

        const startY = -state.cameraY - cellSize * 3;
        const endY = -state.cameraY + height + cellSize * 3;
        const isBettable = col.x > currentHeadX + cellSize * GAME_CONFIG.MIN_BET_COLUMNS_AHEAD;

        Object.entries(col.cells).forEach(([yIdx, cell]) => {
          const yIndex = parseInt(yIdx);
          const y = yIndex * cellSize;
          if (y < startY || y > endY) return;

          ctx.strokeStyle = GAME_CONFIG.GRID_LINE_COLOR;
          ctx.beginPath();
          ctx.moveTo(screenX, y);
          ctx.lineTo(screenX + cellSize, y);
          ctx.stroke();

          ctx.fillStyle = GAME_CONFIG.GRID_DOT_COLOR;
          ctx.beginPath();
          ctx.arc(screenX, y, 1.5, 0, Math.PI * 2);
          ctx.fill();

          // DYNAMIC: Calculate multiplier based on current price position, not stored value
          const dynamicMultiplier = calculateMultiplier(yIndex, currentPriceYIndex);
          const mult = parseFloat(dynamicMultiplier);
          const intensity = Math.min((mult - 1) / 5, 1);
          const alpha = isBettable ? (0.15 + intensity * 0.35) : 0.08;
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.fillText(`${dynamicMultiplier}X`, screenX + cellSize / 2, y + cellSize / 2);
        });
      }

      state.bets.forEach(bet => {
        const col = state.columns.find(c => c.id === bet.colId);
        if (!col) return;

        const screenX = col.x - state.offsetX;
        const y = bet.yIndex * cellSize;
        
        if (screenX < -cellSize || screenX > width) return;

        let fill = '#c8e64c';
        let textColor = '#000';
        
        if (bet.status === 'won') {
          fill = '#4ade80';
        } else if (bet.status === 'lost') {
          fill = 'rgba(239, 68, 68, 0.3)';
          textColor = '#ef4444';
        }

        ctx.fillStyle = fill;
        ctx.fillRect(screenX + 3, y + 3, cellSize - 6, cellSize - 6);
        
        ctx.strokeStyle = bet.status === 'lost' ? '#ef4444' : '#e0f060';
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX + 3, y + 3, cellSize - 6, cellSize - 6);

        ctx.fillStyle = textColor;
        ctx.font = `bold ${isMobile ? 9 : 11}px sans-serif`;
        ctx.fillText(`$${bet.amount}`, screenX + cellSize / 2, y + cellSize / 2 - (isMobile ? 4 : 6));
        
        ctx.font = `${isMobile ? 7 : 9}px sans-serif`;
        ctx.fillStyle = bet.status === 'lost' ? '#ef4444' : 'rgba(0,0,0,0.7)';
        ctx.fillText(`${bet.multiplier.toFixed(2)}X`, screenX + cellSize / 2, y + cellSize / 2 + (isMobile ? 6 : 8));
      });

      if (state.priceHistory.length > 1) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = GAME_CONFIG.PRICE_LINE_GLOW;
        ctx.strokeStyle = GAME_CONFIG.PRICE_LINE_COLOR;
        ctx.lineWidth = isMobile ? 2 : 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        const firstPoint = state.priceHistory[0];
        ctx.moveTo(firstPoint.x - state.offsetX, firstPoint.y);
        
        for (let i = 1; i < state.priceHistory.length; i++) {
          const p = state.priceHistory[i];
          ctx.lineTo(p.x - state.offsetX, p.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(headX, state.priceY, isMobile ? 5 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = GAME_CONFIG.PRICE_LINE_COLOR;
        ctx.beginPath();
        ctx.arc(headX, state.priceY, isMobile ? 2 : 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Price axis
      ctx.fillStyle = '#0a0014';
      ctx.fillRect(width - priceAxisWidth, 0, priceAxisWidth, height);
      
      ctx.strokeStyle = 'rgba(255, 100, 150, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width - priceAxisWidth, 0);
      ctx.lineTo(width - priceAxisWidth, height);
      ctx.stroke();

      const displayPriceValue = priceRef.current ?? currentPrice ?? 100;
      const centerScreenY = height / 2;
      
      ctx.font = `${isMobile ? 9 : 11}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      
      const priceStep = isMobile ? 0.05 : 0.02;
      const labelStep = isMobile ? 2 : 5;
      
      for (let i = -40; i <= 40; i++) {
        const pixelOffset = i * (priceStep * GAME_CONFIG.PRICE_SCALE);
        const screenY = centerScreenY + pixelOffset;
        
        if (screenY < 0 || screenY > height) continue;
        
        const priceAtLevel = displayPriceValue - (i * priceStep);
        
        ctx.strokeStyle = 'rgba(255, 100, 150, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(width - priceAxisWidth, screenY);
        ctx.lineTo(width - priceAxisWidth + 5, screenY);
        ctx.stroke();
        
        if (i % labelStep === 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.fillText(`$${priceAtLevel.toFixed(2)}`, width - 6, screenY);
        }
      }
      
      ctx.fillStyle = GAME_CONFIG.PRICE_LINE_COLOR;
      ctx.fillRect(width - priceAxisWidth, centerScreenY - 12, priceAxisWidth, 24);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${isMobile ? 10 : 12}px "JetBrains Mono", monospace`;
      ctx.fillText(`$${displayPriceValue.toFixed(2)}`, width - 6, centerScreenY);
      
      // Speed bar
      const speedRatio = state.currentSpeed / GAME_CONFIG.GRID_SPEED_ACTIVE;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, height - 4, width - priceAxisWidth, 4);
      
      const speedColor = speedRatio > 0.5 ? '#4ade80' : speedRatio > 0.2 ? '#fbbf24' : '#ef4444';
      ctx.fillStyle = speedColor;
      ctx.fillRect(0, height - 4, (width - priceAxisWidth) * speedRatio, 4);
    };

    const animate = () => {
      updatePhysics();
      render();
      requestRef.current = requestAnimationFrame(animate);
    };

    if (!stateRef.current.initialized) {
      const state = stateRef.current;
      state.offsetX = 0;
      state.priceY = cellSize / 2;
      state.targetPriceY = cellSize / 2;
      state.priceHistory = [{ x: headX, y: cellSize / 2 }];
      state.columns = [];
      state.bets = [];
      state.lastGenX = 0;
      state.cameraY = window.innerHeight / 2;
      state.initialized = true;
      state.recentPrices = [];
      state.currentSpeed = GAME_CONFIG.GRID_SPEED_ACTIVE;
      state.lastPrice = null;
      
      for (let x = 0; x < window.innerWidth + 600; x += cellSize) {
        generateColumn(x, cellSize / 2);
      }
    }

    requestRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [generateColumn, playSound, getCellSize, getHeadX, getPriceAxisWidth, isMobile, onBalanceChange, onTotalWonChange, onTotalLostChange, onWin]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        // Account for sidebar width
        canvasRef.current.width = window.innerWidth - sidebarWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarWidth]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    isDraggingRef.current = true;
    dragBetQueueRef.current = []; // Clear any stale queue
    lastBetCellRef.current = null;
    const rect = canvasRef.current!.getBoundingClientRect();
    placeBetAt(e.clientX - rect.left, e.clientY - rect.top, true);
  }, [placeBetAt]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    // Track hover position for effects
    const state = stateRef.current;
    const cellSize = Math.floor((isMobile ? GAME_CONFIG.CELL_SIZE_MOBILE : GAME_CONFIG.CELL_SIZE) * zoomLevel);
    const headX = isMobile ? GAME_CONFIG.HEAD_X_MOBILE : GAME_CONFIG.HEAD_X;
    
    const worldX = state.offsetX + screenX;
    const worldY = screenY - state.cameraY;
    mouseWorldPosRef.current = { x: worldX, y: worldY };
    
    // Find hovered cell
    const clickedCol = state.columns.find(col => 
      worldX >= col.x && worldX < col.x + cellSize
    );
    
    if (clickedCol) {
      const yIndex = Math.floor(worldY / cellSize);
      const isBettable = clickedCol.x > state.offsetX + headX + cellSize * GAME_CONFIG.MIN_BET_COLUMNS_AHEAD;
      
      if (isBettable) {
        hoverCellRef.current = { colId: clickedCol.id, yIndex };
      } else {
        hoverCellRef.current = null;
      }
    } else {
      hoverCellRef.current = null;
    }
    
    // Handle dragging for bet placement
    if (isDragging) {
      placeBetAt(screenX, screenY, false);
    }
  }, [isDragging, placeBetAt, isMobile, zoomLevel]);

  const handlePointerUp = useCallback(async () => {
    setIsDragging(false);
    isDraggingRef.current = false;
    lastBetCellRef.current = null;
    
    // FLUSH DRAG BET QUEUE - Send all queued bets in one batch
    const queue = dragBetQueueRef.current;
    if (queue.length > 0 && isAuthenticated) {
      dragBetQueueRef.current = []; // Clear queue immediately
      
      try {
        const result = await gameAPI.placeBetBatch({
          sessionId: sessionIdRef.current,
          bets: queue.map(q => ({
            columnId: q.columnId,
            yIndex: q.yIndex,
            basePrice: q.basePrice,
            cellSize: q.cellSize,
            amount: q.amount,
            multiplier: q.multiplier,
          })),
        });
        
        if (result.success && result.results) {
          const state = stateRef.current;
          
          // Update each bet with server response
          for (const betResult of result.results) {
            const queuedBet = queue[betResult.index];
            if (!queuedBet) continue;
            
            const bet = state.bets.find(b => b.id === queuedBet.localId);
            if (!bet) continue;
            
            if (betResult.success && betResult.betId) {
              bet.serverId = betResult.betId;
              bet.status = 'pending';
              bet.winPriceMin = betResult.winPriceMin;
              bet.winPriceMax = betResult.winPriceMax;
            } else {
              // Bet rejected - remove from UI and refund
              const betIndex = state.bets.findIndex(b => b.id === queuedBet.localId);
              if (betIndex !== -1) {
                state.bets.splice(betIndex, 1);
              }
              balanceRef.current += queuedBet.amount;
              pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - queuedBet.amount);
              setPendingBetsCount(prev => Math.max(0, prev - 1));
            }
          }
          
          // Sync balance from server
          if (typeof result.newBalance === 'number') {
            balanceRef.current = result.newBalance;
            onBalanceChange(result.newBalance);
          }
        } else {
          // Entire batch failed - refund all
          const state = stateRef.current;
          for (const queuedBet of queue) {
            const betIndex = state.bets.findIndex(b => b.id === queuedBet.localId);
            if (betIndex !== -1) {
              state.bets.splice(betIndex, 1);
            }
            balanceRef.current += queuedBet.amount;
            pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - queuedBet.amount);
            setPendingBetsCount(prev => Math.max(0, prev - 1));
          }
          onBalanceChange(balanceRef.current);
          onError?.(result.error || 'Failed to place bets');
        }
      } catch (error) {
        // Network error - refund all queued bets
        const state = stateRef.current;
        for (const queuedBet of queue) {
          const betIndex = state.bets.findIndex(b => b.id === queuedBet.localId);
          if (betIndex !== -1) {
            state.bets.splice(betIndex, 1);
          }
          balanceRef.current += queuedBet.amount;
          pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - queuedBet.amount);
          setPendingBetsCount(prev => Math.max(0, prev - 1));
        }
        onBalanceChange(balanceRef.current);
        onError?.('Network error - bets cancelled');
      }
    }
  }, [isAuthenticated, onBalanceChange, onError]);

  const handlePointerLeave = useCallback(() => {
    // Trigger pointer up to flush any queued bets
    if (isDraggingRef.current) {
      handlePointerUp();
    }
    setIsDragging(false);
    isDraggingRef.current = false;
    lastBetCellRef.current = null;
    hoverCellRef.current = null;
    mouseWorldPosRef.current = null;
  }, [handlePointerUp]);

  // Check if there are any active bets (pending or placing)
  const hasActiveBets = stateRef.current.bets.some(
    b => b.status === 'pending' || b.status === 'placing'
  );

  // Cycle through zoom levels - DISABLED when bets are active
  const cycleZoom = useCallback(() => {
    // Don't allow zoom changes while bets are on the board
    const activeBets = stateRef.current.bets.filter(
      b => b.status === 'pending' || b.status === 'placing'
    );
    if (activeBets.length > 0) {
      return; // Zoom locked while bets are active
    }
    setZoomIndex(prev => (prev + 1) % GAME_CONFIG.ZOOM_LEVELS.length);
  }, []);

  return {
    canvasRef,
    volatilityLevel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    isDragging,
    updatePrice,
    pendingBetsCount,
    zoomLevel,
    zoomIndex,
    cycleZoom,
    zoomLocked: hasActiveBets,
  };
}

