'use client';

/**
 * Admin Socket Hook - Uses shared socket connection
 * 
 * Real-time admin dashboard data via Socket.io.
 * NO POLLING - server pushes all updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocket } from '@/contexts/SocketContext';

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

export function useAdminSocket(options: UseAdminSocketOptions = {}): UseAdminSocketReturn {
  const { autoSubscribe = true } = options;
  const { socket, isConnected } = useSocket();
  
  const subscribedRef = useRef(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  
  // Subscribe to admin data when connected
  useEffect(() => {
    if (!socket || !isConnected) {
      setIsSubscribed(false);
      return;
    }
    
    // Avoid duplicate subscriptions
    if (subscribedRef.current) return;
    
    // Receive admin data updates from server
    const handleAdminData = (adminData: AdminData) => {
      setData(adminData);
    };
    
    socket.on('adminData', handleAdminData);
    
    if (autoSubscribe) {
      socket.emit('subscribeAdmin', (response: { success: boolean; data?: AdminData; error?: string }) => {
        if (response.success) {
          subscribedRef.current = true;
          setIsSubscribed(true);
          setError(null);
          if (response.data) {
            setData(response.data);
          }
        } else {
          setError(response.error || 'Failed to subscribe to admin');
        }
      });
    }
    
    return () => {
      socket.off('adminData', handleAdminData);
      if (subscribedRef.current) {
        socket.emit('unsubscribeAdmin');
        subscribedRef.current = false;
      }
      setIsSubscribed(false);
    };
  }, [socket, isConnected, autoSubscribe]);
  
  const subscribe = useCallback(() => {
    if (socket?.connected && !subscribedRef.current) {
      socket.emit('subscribeAdmin', (response: { success: boolean; data?: AdminData; error?: string }) => {
        if (response.success) {
          subscribedRef.current = true;
          setIsSubscribed(true);
          setError(null);
          if (response.data) {
            setData(response.data);
          }
        } else {
          setError(response.error || 'Failed to subscribe');
        }
      });
    }
  }, [socket]);
  
  const unsubscribe = useCallback(() => {
    if (socket?.connected && subscribedRef.current) {
      socket.emit('unsubscribeAdmin');
      subscribedRef.current = false;
      setIsSubscribed(false);
    }
  }, [socket]);
  
  const executeAction = useCallback(async (
    actionType: string, 
    payload?: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> => {
    return new Promise((resolve) => {
      if (!socket?.connected) {
        resolve({ success: false, error: 'Not connected to server' });
        return;
      }
      
      socket.emit('adminAction', { type: actionType, payload }, (response: { success: boolean; result?: unknown; error?: string }) => {
        resolve(response);
      });
    });
  }, [socket]);
  
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
