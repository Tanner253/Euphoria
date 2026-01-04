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

export interface WinInfo {
  amount: number;
  id: string;
  screenX: number;  // Screen X position of winning cell (for popup)
  screenY: number;  // Screen Y position of winning cell (for popup)
}

interface UseGameEngineOptions {
  isMobile: boolean;
  balance: number;
  betAmount: number;
  sessionId: string;  // Game session ID for bet tracking
  isAuthenticated: boolean;  // Whether user is authenticated
  isAutoPlaying?: boolean;  // Auto-play mode (infinite gems, no balance changes)
  sidebarWidth?: number;  // Width of left sidebar to offset canvas
  onBalanceChange: (newBalance: number) => void;  // Server-provided balance updates only
  onWin: (winInfo: WinInfo) => void;
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
  placeBetAt: (screenX: number, screenY: number) => Promise<boolean>; // For auto-play
}

export function useGameEngine({
  isMobile,
  balance,
  betAmount,
  sessionId,
  isAuthenticated,
  isAutoPlaying = false,
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
  
  // Hover and animation state
  const hoverCellRef = useRef<{ colId: string; yIndex: number } | null>(null);
  const mouseWorldPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // Win animation particles (reserved for future animation enhancements)
  // interface WinParticle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
  // const winParticlesRef = useRef<WinParticle[]>([]);
  // interface WinPulse { x: number; y: number; radius: number; maxRadius: number; alpha: number; }
  // const winPulsesRef = useRef<WinPulse[]>([]);

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
    // Use virtual height for camera (accounts for mobile zoom-out)
    const initCameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
    state.cameraY = (window.innerHeight / initCameraScale) / 2;
    
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

  // Track auto-play state in ref for callbacks
  const isAutoPlayingRef = useRef(isAutoPlaying);
  useEffect(() => {
    isAutoPlayingRef.current = isAutoPlaying;
  }, [isAutoPlaying]);
  
  const placeBetAt = useCallback(async (screenX: number, screenY: number, allowDuplicate = false) => {
    const currentBalance = balanceRef.current;
    const currentBetAmount = betAmountRef.current;
    const cellSize = getCellSize();
    const headX = getHeadX();
    const priceAxisWidth = getPriceAxisWidth();
    const autoPlaying = isAutoPlayingRef.current;
    
    // Client-side pre-check (skip if auto-playing - infinite gems)
    if (!autoPlaying && currentBalance < currentBetAmount) {
      onError?.('Insufficient balance');
      return false;
    }
    // Use canvas width (already accounts for sidebar) and scale it for mobile camera zoom
    const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
    const virtualWidth = (canvasRef.current?.width ?? window.innerWidth) / cameraScale;
    if (screenX > virtualWidth - priceAxisWidth) return false;
    
    const state = stateRef.current;
    const worldX = screenX + state.offsetX;
    const worldY = screenY - state.cameraY;
    
    const clickedCol = state.columns.find(c => worldX >= c.x && worldX < c.x + cellSize);
    
    if (clickedCol) {
      const yIndex = Math.floor(worldY / cellSize);
      
      // Validate yIndex is reasonable (prevent negative/extreme values)
      const MAX_Y_INDEX = 100;
      const MIN_Y_INDEX = -100;
      if (yIndex < MIN_Y_INDEX || yIndex > MAX_Y_INDEX) {
        // Only log warning for invalid values (rare case)
        console.warn('[BET] Invalid yIndex:', yIndex, { screenY, cameraY: state.cameraY, worldY });
        return false;
      }
      
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
        
        // IMMEDIATE WIN ZONE CALCULATION - same formula as server
        // This enables instant win zone rendering without waiting for server
        const basePrice = basePriceRef.current ?? 0;
        const cellYTop = yIndex * cellSize;
        const cellYBottom = (yIndex + 1) * cellSize;
        const winPriceMax = basePrice + (cellSize / 2 - cellYTop) / GAME_CONFIG.PRICE_SCALE;
        const winPriceMin = basePrice + (cellSize / 2 - cellYBottom) / GAME_CONFIG.PRICE_SCALE;
        
        // Create bet - demo mode goes straight to pending, authenticated waits for server
        // Store basePriceAtBet AND win boundaries for immediate visualization
        const newBet: Bet = {
          id: localBetId,
          colId: clickedCol.id,
          yIndex,
          amount: currentBetAmount,
          multiplier,
          potentialWin: currentBetAmount * multiplier,
          status: isAuthenticated ? 'placing' : 'pending',
          basePriceAtBet: basePrice,
          winPriceMin,  // Calculated immediately for instant rendering
          winPriceMax,  // Server will overwrite with authoritative values
        };
        
        state.bets.push(newBet);
        setPendingBetsCount(prev => prev + 1);
        
        // IMMEDIATELY deduct balance (optimistic update for instant feedback)
        // Skip if auto-playing - infinite gems mode
        if (!autoPlaying) {
          const newBalance = currentBalance - currentBetAmount;
          balanceRef.current = newBalance;
          onBalanceChange(newBalance);
        }
        
        // DEMO MODE: Done - no server call needed
        if (!isAuthenticated) {
          return true;
        }
        
        // AUTHENTICATED: Track pending amount in case server rejects
        pendingBetAmountRef.current += currentBetAmount;
        
        // DRAG MODE BATCHING: Queue bet if dragging, send later
        // Note: basePrice already defined above for win zone calculation
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
        } catch {
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
          // Helper to get the Y RANGE the price line travels through within column bounds
          // This allows wins when the price TOUCHES the cell at ANY point, not just at center
          const getYRangeInColumn = (colStartX: number, colEndX: number): { minY: number; maxY: number; centerY: number } | null => {
            let minY = Infinity;
            let maxY = -Infinity;
            let centerY: number | null = null;
            const colCenter = colStartX + (colEndX - colStartX) / 2;
            
            for (let i = 0; i < state.priceHistory.length - 1; i++) {
              const p1 = state.priceHistory[i];
              const p2 = state.priceHistory[i + 1];
              
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
              
              // Get Y at center for server communication
              if (segStartX <= colCenter && segEndX >= colCenter) {
                centerY = getYAt(colCenter);
              }
            }
            
            if (minY === Infinity) return null;
            return { minY, maxY, centerY: centerY ?? (minY + maxY) / 2 };
          };
          
          // Get the full Y range the price traveled through in this column
          const yRange = getYRangeInColumn(col.x, col.x + cellSize);
          const priceYAtCrossing = yRange?.centerY ?? headY;
          
          // WIN DETECTION: Check if price line TOUCHED the cell at ANY point
          // The bet wins if the price line's Y range overlaps with the cell's Y range
          const cellTopY = bet.yIndex * cellSize;
          const cellBottomY = cellTopY + cellSize;
          
          // Line touched the cell if ranges overlap
          const isWin = yRange 
            ? (yRange.minY < cellBottomY && yRange.maxY > cellTopY)
            : false;
          
          // DEMO MODE: Resolve client-side
          if (!bet.serverId) {
            bet.status = isWin ? 'won' : 'lost';
            const autoPlaying = isAutoPlayingRef.current;
            
            if (isWin) {
              const winAmount = bet.amount * bet.multiplier;
              // Skip balance changes in auto-play mode (infinite gems)
              if (!autoPlaying) {
                onBalanceChange(balanceRef.current + winAmount);
                balanceRef.current += winAmount;
              }
              onTotalWonChange(prev => prev + winAmount - bet.amount);
              
              // Calculate screen position for win popup
              const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
              const screenX = (col.x - state.offsetX + cellSize / 2) * cameraScale;
              const screenY = (bet.yIndex * cellSize + state.cameraY) * cameraScale;
              
              onWin({ amount: winAmount, id: bet.id, screenX, screenY });
              playSound('win');
            } else {
              // Skip loss tracking in auto-play mode
              if (!autoPlaying) {
                onTotalLostChange(prev => prev + bet.amount);
              }
              playSound('lose');
            }
            setPendingBetsCount(prev => Math.max(0, prev - 1));
            continue;
          }
          
          // AUTHENTICATED: OPTIMISTIC resolution for instant feedback
          // Show win/loss immediately, confirm with server in background
          bet.resolving = true;
          
          // Calculate the price RANGE at crossing for "touch" detection
          const resolveBasePrice = bet.basePriceAtBet ?? basePriceRef.current ?? 0;
          const priceAtCrossing = resolveBasePrice + (cellSize / 2 - priceYAtCrossing) / GAME_CONFIG.PRICE_SCALE;
          
          // Convert Y range to price range for server validation
          const priceRangeMin = yRange 
            ? resolveBasePrice + (cellSize / 2 - yRange.maxY) / GAME_CONFIG.PRICE_SCALE 
            : priceAtCrossing;
          const priceRangeMax = yRange 
            ? resolveBasePrice + (cellSize / 2 - yRange.minY) / GAME_CONFIG.PRICE_SCALE 
            : priceAtCrossing;
          
          // INSTANT FEEDBACK: Update UI immediately based on client calculation
          const autoPlaying = isAutoPlayingRef.current;
          bet.status = isWin ? 'won' : 'lost';
          
          if (isWin) {
            const winAmount = bet.amount * bet.multiplier;
            if (!autoPlaying) {
              onBalanceChange(balanceRef.current + winAmount);
              balanceRef.current += winAmount;
            }
            onTotalWonChange(prev => prev + winAmount - bet.amount);
            
            const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
            const screenX = (col.x - state.offsetX + cellSize / 2) * cameraScale;
            const screenY = (bet.yIndex * cellSize + state.cameraY) * cameraScale;
            onWin({ amount: winAmount, id: bet.id, screenX, screenY });
            playSound('win');
          } else {
            if (!autoPlaying) {
              onTotalLostChange(prev => prev + bet.amount);
            }
            playSound('lose');
          }
          setPendingBetsCount(prev => Math.max(0, prev - 1));
          
          // BACKGROUND: Confirm with server (non-blocking)
          resolveBetOnServer(bet, isWin, priceAtCrossing, priceRangeMin, priceRangeMax);
        }
      }
    };
    
    // Resolve bet on server (async, non-blocking) - confirms optimistic update
    const resolveBetOnServer = async (
      bet: Bet, 
      clientHint: boolean, 
      priceAtCrossing: number,
      priceRangeMin?: number,
      priceRangeMax?: number
    ) => {
      if (!bet.serverId) return;
      
      try {
        const result = await gameAPI.resolveBet(bet.serverId, clientHint, priceAtCrossing, priceRangeMin, priceRangeMax);
        
        if (result.success && result.bet) {
          const serverBet = result.bet;
          const serverIsWin = serverBet.status === 'won';
          const clientWasWin = bet.status === 'won';
          
          // Check if server disagrees with our optimistic update
          if (serverIsWin !== clientWasWin) {
            console.warn('[Bet] Server correction:', { 
              betId: bet.id, 
              clientSaid: bet.status, 
              serverSays: serverBet.status 
            });
            
            // Correct the optimistic update
            bet.status = serverBet.status as 'won' | 'lost';
            const autoPlaying = isAutoPlayingRef.current;
            
            if (serverIsWin && !clientWasWin) {
              // We said loss, server says win - add winnings
              const winAmount = serverBet.actualWin;
              if (!autoPlaying) {
                onBalanceChange(balanceRef.current + winAmount);
                balanceRef.current += winAmount;
              }
              onTotalWonChange(prev => prev + winAmount);
              onTotalLostChange(prev => prev - bet.amount);
              playSound('win');
            } else if (!serverIsWin && clientWasWin) {
              // We said win, server says loss - remove winnings
              const expectedWin = bet.amount * bet.multiplier;
              if (!autoPlaying) {
                onBalanceChange(balanceRef.current - expectedWin);
                balanceRef.current -= expectedWin;
              }
              onTotalWonChange(prev => prev - expectedWin + bet.amount);
              onTotalLostChange(prev => prev + bet.amount);
            }
          }
          
          // Sync balance with server periodically (every 10th resolution)
          if (Math.random() < 0.1) {
            const balanceData = await gameAPI.getBalance();
            if (balanceData?.user) {
              onBalanceChange(balanceData.user.gemsBalance);
              balanceRef.current = balanceData.user.gemsBalance;
            }
          }
        }
      } catch (error) {
        // Network error - optimistic update stands, will reconcile on next balance sync
        console.error('Failed to confirm bet resolution:', error);
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

      // Use virtual height for camera centering (accounts for mobile zoom-out)
      const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
      const virtualHeight = canvas.height / cameraScale;
      const targetCameraY = -state.priceY + virtualHeight / 2;
      state.cameraY += (targetCameraY - state.cameraY) * 0.02;

      state.lastPrice = currentPrice;
      checkBets(currentWorldX, state.priceY);
    };

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const physicalWidth = canvas.width;
      const physicalHeight = canvas.height;
      const state = stateRef.current;
      const currentPrice = priceRef.current ?? basePriceRef.current ?? 0;
      
      // Mobile camera scale - zooms out the view to show more grid
      const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
      // Virtual dimensions (what we render to, scaled up so it fills physical canvas when scaled down)
      const width = physicalWidth / cameraScale;
      const height = physicalHeight / cameraScale;

      // Clear at physical size first
      const gradient = ctx.createLinearGradient(0, 0, 0, physicalHeight);
      gradient.addColorStop(0, '#12001f');
      gradient.addColorStop(0.5, GAME_CONFIG.BG_COLOR);
      gradient.addColorStop(1, '#08000f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, physicalWidth, physicalHeight);

      ctx.save();
      // Apply camera scale for mobile zoom-out effect
      ctx.scale(cameraScale, cameraScale);
      ctx.translate(0, state.cameraY);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Mobile fonts larger to compensate for camera zoom-out (0.65 scale)
      ctx.font = `${isMobile ? 14 : 10}px "JetBrains Mono", "SF Mono", monospace`;
      
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

        Object.entries(col.cells).forEach(([yIdx]) => {
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
        // Mobile fonts larger to compensate for camera zoom-out
        ctx.font = `bold ${isMobile ? 16 : 11}px sans-serif`;
        ctx.fillText(`💎${bet.amount}`, screenX + cellSize / 2, y + cellSize / 2 - (isMobile ? 6 : 6));
        
        ctx.font = `${isMobile ? 12 : 9}px sans-serif`;
        ctx.fillStyle = bet.status === 'lost' ? '#ef4444' : 'rgba(0,0,0,0.7)';
        ctx.fillText(`${bet.multiplier.toFixed(2)}X`, screenX + cellSize / 2, y + cellSize / 2 + (isMobile ? 6 : 8));
        
        // Win zone indicator (simple cyan corners - minimal rendering cost)
        if (bet.winPriceMin !== undefined && bet.winPriceMax !== undefined && bet.basePriceAtBet !== undefined && bet.status === 'pending') {
          const winYTop = -(bet.winPriceMax - bet.basePriceAtBet) * GAME_CONFIG.PRICE_SCALE + cellSize / 2;
          const winYBottom = -(bet.winPriceMin - bet.basePriceAtBet) * GAME_CONFIG.PRICE_SCALE + cellSize / 2;
          
          // Draw simple corner markers (fast)
          ctx.strokeStyle = '#00ffff';
          ctx.lineWidth = 2;
          const cornerSize = 6;
          
          // Top-left corner
          ctx.beginPath();
          ctx.moveTo(screenX, winYTop + cornerSize);
          ctx.lineTo(screenX, winYTop);
          ctx.lineTo(screenX + cornerSize, winYTop);
          ctx.stroke();
          
          // Top-right corner
          ctx.beginPath();
          ctx.moveTo(screenX + cellSize - cornerSize, winYTop);
          ctx.lineTo(screenX + cellSize, winYTop);
          ctx.lineTo(screenX + cellSize, winYTop + cornerSize);
          ctx.stroke();
          
          // Bottom-left corner
          ctx.beginPath();
          ctx.moveTo(screenX, winYBottom - cornerSize);
          ctx.lineTo(screenX, winYBottom);
          ctx.lineTo(screenX + cornerSize, winYBottom);
          ctx.stroke();
          
          // Bottom-right corner
          ctx.beginPath();
          ctx.moveTo(screenX + cellSize - cornerSize, winYBottom);
          ctx.lineTo(screenX + cellSize, winYBottom);
          ctx.lineTo(screenX + cellSize, winYBottom - cornerSize);
          ctx.stroke();
        }
      });

      if (state.priceHistory.length > 1) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = GAME_CONFIG.PRICE_LINE_GLOW;
        ctx.strokeStyle = GAME_CONFIG.PRICE_LINE_COLOR;
        // Mobile line thicker to compensate for camera zoom-out
        ctx.lineWidth = isMobile ? 3.5 : 2.5;
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
        // Mobile circles larger to compensate for camera zoom-out
        ctx.arc(headX, state.priceY, isMobile ? 9 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = GAME_CONFIG.PRICE_LINE_COLOR;
        ctx.beginPath();
        // Mobile circles larger to compensate for camera zoom-out
        ctx.arc(headX, state.priceY, isMobile ? 4 : 3, 0, Math.PI * 2);
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
      
      // Mobile fonts larger to compensate for camera zoom-out
      ctx.font = `${isMobile ? 15 : 11}px "JetBrains Mono", monospace`;
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
      // Mobile fonts larger to compensate for camera zoom-out
      ctx.font = `bold ${isMobile ? 17 : 12}px "JetBrains Mono", monospace`;
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
    // Scale input coordinates for mobile camera zoom-out
    const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
    const screenX = (e.clientX - rect.left) / cameraScale;
    const screenY = (e.clientY - rect.top) / cameraScale;
    placeBetAt(screenX, screenY, true);
  }, [placeBetAt, isMobile]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    // Scale input coordinates for mobile camera zoom-out
    const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
    const screenX = (e.clientX - rect.left) / cameraScale;
    const screenY = (e.clientY - rect.top) / cameraScale;
    
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
      } catch {
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
    placeBetAt,
  };
}

