'use client';

/**
 * Socket Context - SINGLE SOCKET CONNECTION
 * 
 * All game, chat, leaderboard, and admin functionality shares ONE socket.
 * No more duplicate connections to the same server.
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ServerConfig } from '@/lib/game/gameConfig';

// ============ TYPES ============

export interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  serverConfig: ServerConfig | null;
  identify: (walletAddress: string, token?: string) => void;
  refreshBalance: () => Promise<number | null>;
}

// Server URL from environment
const SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'http://localhost:3002';

// ============ CONTEXT ============

const SocketContext = createContext<SocketContextValue | null>(null);

// ============ PROVIDER ============

export function SocketProvider({ children }: { children: React.ReactNode }) {
  // Use state for socket so changes trigger re-renders and propagate to consumers
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  
  // Initialize socket connection ONCE
  useEffect(() => {
    console.log('[Socket] Initializing single socket connection to', SERVER_URL);
    
    const newSocket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    
    // Set socket in state so consumers get the reference
    setSocket(newSocket);
    
    newSocket.on('connect', () => {
      console.log('[Socket] Connected:', newSocket.id);
      setIsConnected(true);
    });
    
    newSocket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setIsConnected(false);
    });
    
    newSocket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });
    
    // Receive server config (SINGLE SOURCE OF TRUTH)
    newSocket.on('serverConfig', (config: ServerConfig) => {
      console.log('[Socket] Received server config:', config ? 'valid' : 'null', 'cellSize:', config?.cellSize);
      setServerConfig(config);
    });
    
    // Cleanup on unmount
    return () => {
      console.log('[Socket] Cleaning up connection');
      newSocket.disconnect();
      setSocket(null);
    };
  }, []);
  
  // Identify user with wallet
  const identify = useCallback((walletAddress: string, token?: string) => {
    if (socket?.connected) {
      socket.emit('identify', { walletAddress, token });
    }
  }, [socket]);
  
  // Request fresh balance from server (useful after database updates)
  const refreshBalance = useCallback((): Promise<number | null> => {
    return new Promise((resolve) => {
      if (!socket?.connected) {
        console.warn('[Socket] Cannot refresh balance - not connected');
        resolve(null);
        return;
      }
      
      socket.emit('refreshBalance', (response: { success: boolean; balance?: number; error?: string }) => {
        if (response.success && response.balance !== undefined) {
          console.log('[Socket] Balance refreshed:', response.balance);
          resolve(response.balance);
        } else {
          console.warn('[Socket] Failed to refresh balance:', response.error);
          resolve(null);
        }
      });
    });
  }, [socket]);
  
  const value: SocketContextValue = {
    socket,
    isConnected,
    serverConfig,
    identify,
    refreshBalance,
  };
  
  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

// ============ HOOK ============

export function useSocket(): SocketContextValue {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}

