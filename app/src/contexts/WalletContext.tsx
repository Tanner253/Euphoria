'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

interface User {
  id: string;
  walletAddress: string;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalWagered: number;
  totalWon: number;
}

interface WalletContextType {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  walletAddress: string | null;
  
  // User data
  user: User | null;
  balance: number;
  
  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  deposit: (solAmount: number) => Promise<{ success: boolean; error?: string }>;
  withdraw: (gemsAmount: number) => Promise<{ success: boolean; error?: string; txHash?: string }>;
  updateBalance: (newBalance: number) => void;
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

export function WalletProvider({ children }: WalletProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState(0);

  // Load saved wallet on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem('walletAddress');
    if (savedWallet) {
      connectWithAddress(savedWallet);
    }
  }, []);

  const connectWithAddress = async (address: string) => {
    try {
      setIsConnecting(true);
      
      const response = await fetch('/api/user/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setUser(data.user);
        setBalance(data.user.balance);
        setWalletAddress(address);
        setIsConnected(true);
        localStorage.setItem('walletAddress', address);
      } else {
        throw new Error(data.error || 'Failed to connect');
      }
    } catch (error) {
      console.error('Connect error:', error);
      localStorage.removeItem('walletAddress');
    } finally {
      setIsConnecting(false);
    }
  };

  const connect = useCallback(async () => {
    // For demo: Generate a random wallet address
    // In production: Use Phantom or Solana wallet adapter
    
    // Check if Phantom is available
    const phantom = (window as Window & { solana?: { isPhantom?: boolean; connect?: () => Promise<{ publicKey: { toString: () => string } }> } }).solana;
    
    if (phantom?.isPhantom) {
      try {
        setIsConnecting(true);
        const response = await phantom.connect!();
        const address = response.publicKey.toString();
        await connectWithAddress(address);
      } catch (error) {
        console.error('Phantom connect error:', error);
        // Fall back to demo wallet
        const demoAddress = `demo_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
        await connectWithAddress(demoAddress);
      }
    } else {
      // No wallet found, use demo address
      const demoAddress = `demo_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`;
      await connectWithAddress(demoAddress);
    }
  }, []);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setWalletAddress(null);
    setUser(null);
    setBalance(0);
    localStorage.removeItem('walletAddress');
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return;
    
    try {
      const response = await fetch(`/api/user/balance?wallet=${encodeURIComponent(walletAddress)}`);
      const data = await response.json();
      
      if (data.balance !== undefined) {
        setBalance(data.balance);
        if (user) {
          setUser({
            ...user,
            balance: data.balance,
            totalDeposited: data.totalDeposited,
            totalWithdrawn: data.totalWithdrawn,
            totalWagered: data.totalWagered,
            totalWon: data.totalWon,
          });
        }
      }
    } catch (error) {
      console.error('Balance refresh error:', error);
    }
  }, [walletAddress, user]);

  const deposit = useCallback(async (solAmount: number) => {
    if (!walletAddress) {
      return { success: false, error: 'Wallet not connected' };
    }
    
    try {
      // For demo: Simulate deposit
      // In production: Initiate actual Solana transfer to custodial wallet
      const response = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          solAmount,
          txHash: `sim_${Date.now()}`, // Simulated tx hash
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setBalance(data.deposit.newBalance);
        return { success: true };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('Deposit error:', error);
      return { success: false, error: 'Deposit failed' };
    }
  }, [walletAddress]);

  const withdraw = useCallback(async (gemsAmount: number) => {
    if (!walletAddress) {
      return { success: false, error: 'Wallet not connected' };
    }
    
    try {
      const response = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, gemsAmount }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setBalance(data.withdrawal.newBalance);
        return { success: true, txHash: data.withdrawal.txHash };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('Withdraw error:', error);
      return { success: false, error: 'Withdrawal failed' };
    }
  }, [walletAddress]);

  const updateBalance = useCallback((newBalance: number) => {
    setBalance(newBalance);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        isConnected,
        isConnecting,
        walletAddress,
        user,
        balance,
        connect,
        disconnect,
        refreshBalance,
        deposit,
        withdraw,
        updateBalance,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

