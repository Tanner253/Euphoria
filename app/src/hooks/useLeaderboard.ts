'use client';

/**
 * Live Leaderboard Hook - Uses shared socket connection
 * 
 * Pure Socket.io - NO POLLING.
 * Server pushes all updates in real-time.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from '@/contexts/SocketContext';

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

export function useLeaderboard(options: UseLeaderboardOptions = {}): UseLeaderboardReturn {
  const { autoSubscribe = true } = options;
  const { socket, isConnected } = useSocket();
  
  const subscribedRef = useRef(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [recentWins, setRecentWins] = useState<RecentWin[]>([]);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  
  // Subscribe to leaderboard when connected
  useEffect(() => {
    if (!socket || !isConnected) {
      setIsSubscribed(false);
      return;
    }
    
    // Avoid duplicate subscriptions
    if (subscribedRef.current) return;
    
    // Receive leaderboard data from server
    const handleLeaderboard = (data: LeaderboardData) => {
      setLeaderboard(data.leaderboard || []);
      setRecentWins(data.recentWins || []);
      setLiveStats(data.liveStats || null);
    };
    
    // Receive real-time win notifications
    const handleRecentWin = (win: RecentWin) => {
      setRecentWins(prev => [win, ...prev.slice(0, 19)]);
    };
    
    socket.on('leaderboard', handleLeaderboard);
    socket.on('recentWin', handleRecentWin);
    
    if (autoSubscribe) {
      socket.emit('subscribeLeaderboard');
      subscribedRef.current = true;
      setIsSubscribed(true);
    }
    
    return () => {
      socket.off('leaderboard', handleLeaderboard);
      socket.off('recentWin', handleRecentWin);
      if (subscribedRef.current) {
        socket.emit('unsubscribeLeaderboard');
        subscribedRef.current = false;
      }
      setIsSubscribed(false);
    };
  }, [socket, isConnected, autoSubscribe]);
  
  const subscribe = useCallback(() => {
    if (socket?.connected && !subscribedRef.current) {
      socket.emit('subscribeLeaderboard');
      subscribedRef.current = true;
      setIsSubscribed(true);
    }
  }, [socket]);
  
  const unsubscribe = useCallback(() => {
    if (socket?.connected && subscribedRef.current) {
      socket.emit('unsubscribeLeaderboard');
      subscribedRef.current = false;
      setIsSubscribed(false);
    }
  }, [socket]);
  
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
