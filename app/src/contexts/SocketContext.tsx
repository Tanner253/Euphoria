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
}

// Server URL from environment
const SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'http://localhost:3002';

// ============ CONTEXT ============

const SocketContext = createContext<SocketContextValue | null>(null);

// ============ PROVIDER ============

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  
  // Initialize socket connection ONCE
  useEffect(() => {
    console.log('[Socket] Initializing single socket connection to', SERVER_URL);
    
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      setIsConnected(true);
    });
    
    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setIsConnected(false);
    });
    
    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });
    
    // Receive server config (SINGLE SOURCE OF TRUTH)
    socket.on('serverConfig', (config: ServerConfig) => {
      console.log('[Socket] Received server config');
      setServerConfig(config);
    });
    
    // Cleanup on unmount
    return () => {
      console.log('[Socket] Cleaning up connection');
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);
  
  // Identify user with wallet
  const identify = useCallback((walletAddress: string, token?: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('identify', { walletAddress, token });
    }
  }, []);
  
  const value: SocketContextValue = {
    socket: socketRef.current,
    isConnected,
    serverConfig,
    identify,
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

