'use client';

/**
 * Client-Side Game Socket Hook
 * 
 * Connects to the authoritative game server and receives state updates.
 * The client ONLY renders - it does NOT calculate game state.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// ============ TYPES ============

export interface PricePoint {
  x: number;
  y: number;
}

export interface Column {
  id: string;
  x: number;
  cells: Record<number, Cell>;
}

export interface Cell {
  id: string;
  multiplier: string;
}

export interface HeatmapCell {
  colId: string;
  yIndex: number;
  betCount: number;
  totalWagered: number;
  heat: number;  // 0-1 normalized
}

export interface ServerBet {
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

export interface GameState {
  priceY: number;
  targetPriceY: number;
  offsetX: number;
  currentPrice: number | null;
  volatility: 'active' | 'low' | 'idle';
  gridSpeed: number;
  serverTime: number;
  priceHistory: PricePoint[];
  columns: Column[];
  bets: ServerBet[];
  heatmap: HeatmapCell[];
}

export interface UserData {
  walletAddress: string;
  gemsBalance: number;
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  status: string;
}

export interface BalanceUpdate {
  newBalance: number;
  reason: string;
  betId?: string;
  won?: boolean;
}

export interface UseGameSocketOptions {
  serverUrl?: string;
  walletAddress?: string;
  isMobile?: boolean;
  zoomLevel?: number;
  onBetResolved?: (bet: ServerBet, won: boolean, newBalance?: number) => void;
  onBalanceUpdate?: (update: BalanceUpdate) => void;
  onUserData?: (userData: UserData) => void;
}

export interface UseGameSocketReturn {
  // Connection state
  isConnected: boolean;
  error: string | null;
  latency: number;
  
  // Game state from server
  gameState: GameState | null;
  
  // User data from server
  userData: UserData | null;
  
  // Actions
  placeBet: (bet: {
    colId: string;
    yIndex: number;
    wager: number;
    oddsIndex: number;
    oddsMultiplier: string;
    sessionId?: string;
    basePrice?: number;
    cellSize?: number;
    useDatabase?: boolean;
  }) => Promise<{ success: boolean; bet?: ServerBet; error?: string; newBalance?: number; dbBetId?: string }>;
  setZoomLevel: (zoom: number) => void;
  reconnect: () => void;
  getUserData: () => Promise<{ success: boolean; user?: UserData; error?: string }>;
}

// Default server URL (can be overridden via env or prop)
const DEFAULT_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'http://localhost:3002';

export function useGameSocket(options: UseGameSocketOptions = {}): UseGameSocketReturn {
  const {
    serverUrl = DEFAULT_SERVER_URL,
    walletAddress,
    isMobile = false,
    zoomLevel = 1.0,
    onBetResolved,
    onBalanceUpdate,
    onUserData,
  } = options;
  
  // Socket ref
  const socketRef = useRef<Socket | null>(null);
  
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState(0);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  
  // Track previous bets to detect resolutions
  const prevBetsRef = useRef<Map<string, ServerBet>>(new Map());
  
  // Store callbacks in refs to avoid reconnection on callback change
  const onBetResolvedRef = useRef(onBetResolved);
  const onBalanceUpdateRef = useRef(onBalanceUpdate);
  const onUserDataRef = useRef(onUserData);
  
  useEffect(() => {
    onBetResolvedRef.current = onBetResolved;
    onBalanceUpdateRef.current = onBalanceUpdate;
    onUserDataRef.current = onUserData;
  }, [onBetResolved, onBalanceUpdate, onUserData]);
  
  // Connect to server
  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;
    
    console.log(`[GameSocket] Connecting to ${serverUrl}...`);
    
    const socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
    
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log('[GameSocket] Connected');
      setIsConnected(true);
      setError(null);
      
      // Identify ourselves to the server
      socket.emit('identify', {
        walletAddress,
        isMobile,
        zoomLevel,
      });
    });
    
    socket.on('disconnect', (reason) => {
      console.log(`[GameSocket] Disconnected: ${reason}`);
      setIsConnected(false);
    });
    
    socket.on('connect_error', (err) => {
      console.error('[GameSocket] Connection error:', err.message);
      setError(`Connection error: ${err.message}`);
      setIsConnected(false);
    });
    
    // Receive authoritative game state from server
    socket.on('gameState', (state: GameState) => {
      setGameState(state);
      
      // Check for resolved bets (compare with previous state)
      if (onBetResolved) {
        const currentBets = new Map(state.bets.map(b => [b.id, b]));
        
        for (const [betId, prevBet] of prevBetsRef.current) {
          const currentBet = currentBets.get(betId);
          
          // Bet was resolved (no longer in active bets or status changed)
          if (!currentBet || (currentBet.status !== 'pending' && currentBet.status !== 'placing')) {
            if (prevBet.status === 'pending' || prevBet.status === 'placing') {
              onBetResolved(currentBet || { ...prevBet, status: 'lost' });
            }
          }
        }
        
        // Update prev bets
        prevBetsRef.current = currentBets;
      }
    });
    
    // Receive bet placement confirmations
    socket.on('betPlaced', (bet: ServerBet) => {
      console.log('[GameSocket] Bet placed:', bet.id);
    });
    
    // DIRECT bet resolution from server (authoritative)
    socket.on('betResolved', (data: { bet: ServerBet; won: boolean; newBalance?: number; dbBetId?: string }) => {
      console.log('[GameSocket] Bet resolved:', data.bet.id, data.won ? 'WON' : 'LOST');
      if (onBetResolvedRef.current) {
        onBetResolvedRef.current(data.bet, data.won, data.newBalance);
      }
    });
    
    // Balance update from server (after bet resolution, deposits, etc.)
    socket.on('balanceUpdate', (update: BalanceUpdate) => {
      console.log('[GameSocket] Balance update:', update.newBalance, update.reason);
      if (onBalanceUpdateRef.current) {
        onBalanceUpdateRef.current(update);
      }
    });
    
    // User data from server (on identify or request)
    socket.on('userData', (data: UserData) => {
      console.log('[GameSocket] User data received:', data.walletAddress);
      setUserData(data);
      if (onUserDataRef.current) {
        onUserDataRef.current(data);
      }
    });
    
    // Latency measurement
    socket.on('pong', (data: { sent: number; server: number }) => {
      const rtt = Date.now() - data.sent;
      setLatency(rtt);
    });
    
    // Start latency ping
    const pingInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('ping', Date.now());
      }
    }, 5000);
    
    // Cleanup on unmount
    return () => {
      clearInterval(pingInterval);
      socket.disconnect();
    };
  }, [serverUrl, walletAddress, isMobile, zoomLevel, onBetResolved]);
  
  // Connect on mount
  useEffect(() => {
    const cleanup = connect();
    return () => {
      cleanup?.();
      socketRef.current?.disconnect();
    };
  }, [connect]);
  
  // Update server when wallet changes
  useEffect(() => {
    if (socketRef.current?.connected && walletAddress) {
      socketRef.current.emit('identify', {
        walletAddress,
        isMobile,
        zoomLevel,
      });
    }
  }, [walletAddress, isMobile, zoomLevel]);
  
  // Place bet (sends to server for validation and database recording)
  const placeBet = useCallback(async (betData: {
    colId: string;
    yIndex: number;
    wager: number;
    oddsIndex: number;
    oddsMultiplier: string;
    sessionId?: string;
    basePrice?: number;
    cellSize?: number;
    useDatabase?: boolean;
  }): Promise<{ success: boolean; bet?: ServerBet; error?: string; newBalance?: number; dbBetId?: string }> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: 'Not connected to server' });
        return;
      }
      
      socketRef.current.emit('placeBet', betData, (response: { success: boolean; bet?: ServerBet; error?: string; newBalance?: number; dbBetId?: string }) => {
        resolve(response);
      });
    });
  }, []);
  
  // Get user data from server
  const getUserData = useCallback(async (): Promise<{ success: boolean; user?: UserData; error?: string }> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: 'Not connected to server' });
        return;
      }
      
      socketRef.current.emit('getUserData', (response: { success: boolean; user?: UserData; error?: string }) => {
        if (response.success && response.user) {
          setUserData(response.user);
        }
        resolve(response);
      });
    });
  }, []);
  
  // Set zoom level on server
  const setZoomLevel = useCallback((zoom: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('setZoom', zoom);
    }
  }, []);
  
  // Reconnect manually
  const reconnect = useCallback(() => {
    socketRef.current?.disconnect();
    connect();
  }, [connect]);
  
  return {
    isConnected,
    error,
    latency,
    gameState,
    userData,
    placeBet,
    setZoomLevel,
    reconnect,
    getUserData,
  };
}

