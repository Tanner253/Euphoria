'use client';

/**
 * Live Leaderboard Hook
 * 
 * Pure Socket.io connection - NO POLLING.
 * Server pushes all updates in real-time.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

// ============ TYPES ============

export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  displayName: string;
  netProfit: number;
  totalWins: number;
  winRate: number;
  biggestWin: number;
  isOnline: boolean;
}

export interface RecentWin {
  walletAddress: string;
  displayName: string;
  amount: number;
  multiplier: string;
  timestamp: number;
}

export interface LiveStats {
  onlinePlayers: number;
  totalBetsToday: number;
  totalVolumeToday: number;
}

export interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  recentWins: RecentWin[];
  liveStats: LiveStats;
}

export interface UseLeaderboardOptions {
  serverUrl?: string;
  autoSubscribe?: boolean;
}

export interface UseLeaderboardReturn {
  isConnected: boolean;
  isSubscribed: boolean;
  leaderboard: LeaderboardEntry[];
  recentWins: RecentWin[];
  liveStats: LiveStats | null;
  subscribe: () => void;
  unsubscribe: () => void;
}

// Server URL from environment
const DEFAULT_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'http://localhost:3002';

export function useLeaderboard(options: UseLeaderboardOptions = {}): UseLeaderboardReturn {
  const {
    serverUrl = DEFAULT_SERVER_URL,
    autoSubscribe = true,
  } = options;
  
  const socketRef = useRef<Socket | null>(null);
  
  const [isConnected, setIsConnected] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [recentWins, setRecentWins] = useState<RecentWin[]>([]);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  
  // Connect to server - pure Socket.io, no polling
  useEffect(() => {
    const socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log('[Leaderboard] Connected to server');
      setIsConnected(true);
      
      if (autoSubscribe) {
        socket.emit('subscribeLeaderboard');
        setIsSubscribed(true);
      }
    });
    
    socket.on('disconnect', () => {
      console.log('[Leaderboard] Disconnected from server');
      setIsConnected(false);
      setIsSubscribed(false);
    });
    
    // Receive leaderboard data from server
    socket.on('leaderboard', (data: LeaderboardData) => {
      setLeaderboard(data.leaderboard || []);
      setRecentWins(data.recentWins || []);
      setLiveStats(data.liveStats || null);
    });
    
    // Receive real-time win notifications
    socket.on('recentWin', (win: RecentWin) => {
      setRecentWins(prev => [win, ...prev.slice(0, 19)]);
    });
    
    return () => {
      socket.disconnect();
    };
  }, [serverUrl, autoSubscribe]);
  
  const subscribe = useCallback(() => {
    if (socketRef.current?.connected && !isSubscribed) {
      socketRef.current.emit('subscribeLeaderboard');
      setIsSubscribed(true);
    }
  }, [isSubscribed]);
  
  const unsubscribe = useCallback(() => {
    if (socketRef.current?.connected && isSubscribed) {
      socketRef.current.emit('unsubscribeLeaderboard');
      setIsSubscribed(false);
    }
  }, [isSubscribed]);
  
  return {
    isConnected,
    isSubscribed,
    leaderboard,
    recentWins,
    liveStats,
    subscribe,
    unsubscribe,
  };
}
