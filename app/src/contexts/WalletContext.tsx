'use client';

/**
 * WalletContext - Provides wallet connection state and x403 authentication
 * throughout the application.
 * 
 * Uses x403 protocol for read-only signature-based authentication.
 * No funds are transferred during authentication.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import PhantomWallet from '@/lib/wallet/PhantomWallet';
import X403Service from '@/lib/wallet/X403Service';
import { getGameSounds } from '@/lib/audio/GameSounds';
import { gameAPI } from '@/lib/services/GameAPI';

interface WalletContextType {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  walletAddress: string | null;
  
  // Authentication
  isAuthenticated: boolean;
  authPayload: string | null;
  authError: string | null;
  authToken: string | null; // JWT token for API calls
  
  // Balance (from server for authenticated users)
  gemsBalance: number;
  
  // Demo mode (for users without wallet)
  isDemoMode: boolean;
  demoBalance: number;
  
  // Actions
  connect: () => Promise<{ success: boolean; error?: string }>;
  disconnect: () => void;
  updateDemoBalance: (newBalance: number) => void;
  updateGemsBalance: (newBalance: number) => void; // For direct balance updates from socket
  refreshBalance: () => Promise<void>;
  
  // Socket-based balance update handler (called by useGameSocket)
  handleBalanceUpdate: (newBalance: number, reason?: string) => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

interface WalletProviderProps {
  children: ReactNode;
}

const SESSION_KEY = 'euphoria_wallet_session';
const DEMO_BALANCE_KEY = 'euphoria_demo_balance';
const INITIAL_DEMO_BALANCE = 1000;

interface StoredSession {
  walletAddress: string;
  authPayload: string;
  authToken: string;
  timestamp: number;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authPayload, setAuthPayload] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [gemsBalance, setGemsBalance] = useState(0);
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [demoBalance, setDemoBalance] = useState(INITIAL_DEMO_BALANCE);

  // Fetch user balance from server - defined early for use in initialization
  const fetchBalance = useCallback(async (token: string) => {
    try {
      const response = await fetch('/api/user/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setGemsBalance(data.user?.gemsBalance || 0);
      }
    } catch {
      // Silent failure - balance will remain at previous value
    }
  }, []);

  // Initialize - check for saved session and demo balance
  useEffect(() => {
    // Load demo balance
    const savedBalance = localStorage.getItem(DEMO_BALANCE_KEY);
    if (savedBalance) {
      setDemoBalance(parseFloat(savedBalance));
    }

    // Try to restore wallet session
    const savedSession = localStorage.getItem(SESSION_KEY);
    if (savedSession) {
      try {
        const session: StoredSession = JSON.parse(savedSession);
        const x403Service = X403Service.getInstance();
        
        // Check if session is still valid (30 minutes)
        if (x403Service.isPayloadValid(session.authPayload, 30) && session.authToken) {
          // Check if Phantom is still connected
          const wallet = PhantomWallet.getInstance();
          if (wallet.isPhantomInstalled()) {
            // Attempt silent reconnect
            wallet.connect().then(result => {
              if (result.success && result.publicKey === session.walletAddress) {
                setWalletAddress(session.walletAddress);
                setAuthPayload(session.authPayload);
                setAuthToken(session.authToken);
                setIsConnected(true);
                setIsAuthenticated(true);
                setIsDemoMode(false);
                // Fetch current balance from server
                fetchBalance(session.authToken);
              } else {
                // Session wallet doesn't match, clear it
                localStorage.removeItem(SESSION_KEY);
              }
            });
          }
        } else {
          // Session expired, clear it
          localStorage.removeItem(SESSION_KEY);
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
  }, [fetchBalance]);

  // Save demo balance when it changes
  useEffect(() => {
    if (isDemoMode) {
      localStorage.setItem(DEMO_BALANCE_KEY, demoBalance.toString());
    }
  }, [demoBalance, isDemoMode]);

  // Sync auth token with GameAPI for server-authoritative betting
  useEffect(() => {
    gameAPI.setToken(authToken);
  }, [authToken]);

  const refreshBalance = useCallback(async () => {
    if (authToken) {
      await fetchBalance(authToken);
    }
  }, [authToken, fetchBalance]);

  // NOTE: Balance updates now primarily come via Socket.io (useGameSocket)
  // The socket emits 'balanceUpdate' events which should call handleBalanceUpdate
  // No polling needed - socket is the source of truth for balance changes

  const connect = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setIsConnecting(true);
    setAuthError(null);
    
    try {
      const wallet = PhantomWallet.getInstance();
      const sounds = getGameSounds();
      
      // Step 1: Connect to Phantom
      const connectResult = await wallet.connect();
      
      if (!connectResult.success) {
        setAuthError(connectResult.error || 'Connection failed');
        setIsConnecting(false);
        return { success: false, error: connectResult.error };
      }
      
      const address = connectResult.publicKey!;
      setWalletAddress(address);
      setIsConnected(true);
      
      // Step 2: Create x403 authentication signature
      const x403Service = X403Service.getInstance();
      const authResult = await x403Service.createAuthSignature('Euphoria');
      
      if (!authResult.success) {
        setAuthError(authResult.error || 'Authentication failed');
        setIsConnecting(false);
        
        // If user rejected, disconnect
        if (authResult.error === 'USER_REJECTED') {
          await wallet.disconnect();
          setWalletAddress(null);
          setIsConnected(false);
          return { success: false, error: authResult.error };
        }
        
        return { success: false, error: authResult.error };
      }
      
      // Step 3: Verify with server and get JWT
      let serverToken: string | null = null;
      let serverBalance = 0;
      
      try {
        const verifyResponse = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: authResult.payload })
        });
        
        if (verifyResponse.ok) {
          const data = await verifyResponse.json();
          serverToken = data.token;
          serverBalance = data.user?.gemsBalance || 0;
        }
      } catch {
        // Server verification unavailable - continue without server token
      }
      
      // Step 4: Store session
      setAuthPayload(authResult.payload!);
      setAuthToken(serverToken);
      setGemsBalance(serverBalance);
      setIsAuthenticated(true);
      setIsDemoMode(false);
      
      const session: StoredSession = {
        walletAddress: address,
        authPayload: authResult.payload!,
        authToken: serverToken || '',
        timestamp: Date.now()
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      
      // Play connect sound
      sounds.play('connect');
      
      setIsConnecting(false);
      return { success: true };
      
    } catch (error) {
      const errorMessage = (error as Error).message || 'Connection failed';
      setAuthError(errorMessage);
      setIsConnecting(false);
      return { success: false, error: errorMessage };
    }
  }, []);

  const disconnect = useCallback(() => {
    const wallet = PhantomWallet.getInstance();
    const sounds = getGameSounds();
    
    wallet.disconnect();
    
    setIsConnected(false);
    setWalletAddress(null);
    setIsAuthenticated(false);
    setAuthPayload(null);
    setAuthToken(null);
    setAuthError(null);
    setGemsBalance(0);
    setIsDemoMode(true);
    
    localStorage.removeItem(SESSION_KEY);
    
    // Play disconnect sound
    sounds.play('disconnect');
  }, []);

  const updateDemoBalance = useCallback((newBalance: number) => {
    setDemoBalance(newBalance);
  }, []);

  // Update gems balance directly (for socket-based updates)
  const updateGemsBalance = useCallback((newBalance: number) => {
    setGemsBalance(newBalance);
  }, []);
  
  // Handle balance update from socket (called by useGameSocket)
  const handleBalanceUpdate = useCallback((newBalance: number, reason?: string) => {
    console.log(`[Wallet] Balance update via socket: ${newBalance} gems${reason ? ` (${reason})` : ''}`);
    setGemsBalance(newBalance);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        isConnected,
        isConnecting,
        walletAddress,
        isAuthenticated,
        authPayload,
        authToken,
        authError,
        gemsBalance,
        isDemoMode,
        demoBalance,
        connect,
        disconnect,
        updateDemoBalance,
        updateGemsBalance,
        refreshBalance,
        handleBalanceUpdate,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
