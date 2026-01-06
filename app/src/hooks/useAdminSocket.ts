'use client';

/**
 * Admin Socket Hook
 * 
 * Real-time admin dashboard data via Socket.io.
 * NO POLLING - server pushes all updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

// ============ TYPES ============

export interface AdminStats {
  users: { total: number; active24h: number; gemsInCirculation: number };
  betting: { 
    totalBets: number; 
    totalWins: number; 
    totalLosses: number; 
    totalWagered: number; 
    totalPaidOut: number; 
    houseProfit: number;
  };
}

export interface AdminTransaction {
  _id?: string;
  walletAddress: string;
  type: 'deposit' | 'withdrawal';
  status: string;
  solAmount: number;
  gemsAmount: number;
  feeAmount?: number;
  txSignature?: string;
  createdAt: Date;
  confirmedAt?: Date;
  notes?: string;
}

export interface AdminUser {
  _id?: string;
  walletAddress: string;
  gemsBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  status: string;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface AdminBet {
  _id?: string;
  walletAddress: string;
  amount: number;
  multiplier: number;
  potentialWin: number;
  actualWin?: number;
  status: string;
  priceAtBet: number;
  priceAtResolution?: number;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface AdminAlert {
  type: 'error' | 'warning' | 'info';
  message: string;
  timestamp: string;
}

export interface AdminData {
  stats: AdminStats;
  transactions: AdminTransaction[];
  users: AdminUser[];
  bets: AdminBet[];
  alerts: AdminAlert[];
}

export interface UseAdminSocketOptions {
  serverUrl?: string;
  autoSubscribe?: boolean;
}

export interface UseAdminSocketReturn {
  isConnected: boolean;
  isSubscribed: boolean;
  error: string | null;
  data: AdminData | null;
  subscribe: () => void;
  unsubscribe: () => void;
  executeAction: (actionType: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; result?: unknown; error?: string }>;
}

// Server URL from environment
const DEFAULT_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'http://localhost:3002';

export function useAdminSocket(options: UseAdminSocketOptions = {}): UseAdminSocketReturn {
  const {
    serverUrl = DEFAULT_SERVER_URL,
    autoSubscribe = true,
  } = options;
  
  const socketRef = useRef<Socket | null>(null);
  
  const [isConnected, setIsConnected] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  
  // Connect to server
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
      console.log('[AdminSocket] Connected to server');
      setIsConnected(true);
      setError(null);
      
      if (autoSubscribe) {
        socket.emit('subscribeAdmin', (response: { success: boolean; data?: AdminData; error?: string }) => {
          if (response.success) {
            setIsSubscribed(true);
            if (response.data) {
              setData(response.data);
            }
          } else {
            setError(response.error || 'Failed to subscribe to admin');
          }
        });
      }
    });
    
    socket.on('disconnect', () => {
      console.log('[AdminSocket] Disconnected from server');
      setIsConnected(false);
      setIsSubscribed(false);
    });
    
    socket.on('connect_error', (err) => {
      console.error('[AdminSocket] Connection error:', err.message);
      setError(`Connection error: ${err.message}`);
    });
    
    // Receive admin data updates from server
    socket.on('adminData', (adminData: AdminData) => {
      console.log('[AdminSocket] Received admin data update');
      setData(adminData);
    });
    
    return () => {
      socket.disconnect();
    };
  }, [serverUrl, autoSubscribe]);
  
  const subscribe = useCallback(() => {
    if (socketRef.current?.connected && !isSubscribed) {
      socketRef.current.emit('subscribeAdmin', (response: { success: boolean; data?: AdminData; error?: string }) => {
        if (response.success) {
          setIsSubscribed(true);
          if (response.data) {
            setData(response.data);
          }
        } else {
          setError(response.error || 'Failed to subscribe');
        }
      });
    }
  }, [isSubscribed]);
  
  const unsubscribe = useCallback(() => {
    if (socketRef.current?.connected && isSubscribed) {
      socketRef.current.emit('unsubscribeAdmin');
      setIsSubscribed(false);
    }
  }, [isSubscribed]);
  
  const executeAction = useCallback(async (
    actionType: string, 
    payload?: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: 'Not connected to server' });
        return;
      }
      
      socketRef.current.emit('adminAction', { type: actionType, payload }, (response: { success: boolean; result?: unknown; error?: string }) => {
        resolve(response);
      });
    });
  }, []);
  
  return {
    isConnected,
    isSubscribed,
    error,
    data,
    subscribe,
    unsubscribe,
    executeAction,
  };
}

