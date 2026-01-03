'use client';

/**
 * WalletButton - Compact wallet connection button with status indicator
 * Shows connection state and allows quick wallet connection/disconnection
 */

import React, { useState } from 'react';
import { Wallet, ChevronDown, LogOut, AlertTriangle, Loader2 } from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import WalletAuth from './WalletAuth';

interface WalletButtonProps {
  compact?: boolean;
  className?: string;
}

export default function WalletButton({ compact = false, className = '' }: WalletButtonProps) {
  const {
    isConnected,
    isConnecting,
    walletAddress,
    isDemoMode,
    disconnect
  } = useWallet();
  
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  
  const shortAddress = walletAddress 
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` 
    : '';
  
  // Authenticated state - show connected button with dropdown
  if (isConnected && walletAddress) {
    return (
      <div className={`relative ${className}`}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className={`flex items-center bg-gradient-to-r from-green-600 to-emerald-600 
                     hover:from-green-500 hover:to-emerald-500 rounded-xl text-white font-medium
                     shadow-lg border border-green-400/30 transition-all ${
                       compact ? 'gap-1 px-2 py-1.5 text-xs' : 'gap-2 px-3 py-2 text-sm'
                     }`}
        >
          <div className={`bg-green-300 rounded-full animate-pulse ${compact ? 'w-1.5 h-1.5' : 'w-2 h-2'}`} />
          {!compact && <span className="hidden sm:inline font-mono">{shortAddress}</span>}
          {compact && <span>✓</span>}
          {!compact && <ChevronDown className="w-4 h-4" />}
        </button>
        
        {showDropdown && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setShowDropdown(false)} 
            />
            
            {/* Dropdown */}
            <div className="absolute top-full right-0 mt-2 w-64 bg-black/95 backdrop-blur-xl rounded-xl 
                            shadow-2xl border border-white/10 overflow-hidden z-50">
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 
                                  flex items-center justify-center text-lg">
                    <Wallet className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-medium text-white">Connected</div>
                    <div className="text-xs text-white/50 font-mono">{shortAddress}</div>
                  </div>
                </div>
              </div>
              
              <div className="p-3 border-b border-white/10">
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  x403 Authenticated
                </div>
                <p className="text-xs text-white/40 mt-1">
                  Read-only signature • No funds at risk
                </p>
              </div>
              
              <button
                onClick={() => {
                  disconnect();
                  setShowDropdown(false);
                }}
                className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-red-900/20 
                           transition-colors flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Disconnect Wallet
              </button>
            </div>
          </>
        )}
      </div>
    );
  }
  
  // Guest/Demo state - show connect button
  return (
    <>
      <div className={`flex items-center gap-2 ${className}`}>
        {/* Demo mode indicator */}
        {isDemoMode && !compact && (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-amber-900/50 rounded-lg 
                          border border-amber-500/30 text-amber-300 text-xs">
            <AlertTriangle className="w-3 h-3" />
            <span>Demo</span>
          </div>
        )}
        
        {/* Connect button */}
        <button
          onClick={() => setShowAuthModal(true)}
          disabled={isConnecting}
          className={`flex items-center bg-gradient-to-r from-purple-600 to-indigo-600 
                     hover:from-purple-500 hover:to-indigo-500 disabled:from-slate-600 disabled:to-slate-700
                     rounded-xl text-white font-medium shadow-lg border border-purple-400/30 
                     transition-all disabled:cursor-wait ${
                       compact ? 'gap-1 px-2 py-1.5 text-xs' : 'gap-2 px-3 py-2 text-sm'
                     }`}
        >
          {isConnecting ? (
            <>
              <Loader2 className={`animate-spin ${compact ? 'w-3 h-3' : 'w-4 h-4'}`} />
              {!compact && <span>Connecting...</span>}
            </>
          ) : (
            <>
              <Wallet className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
              <span>{compact ? 'Sign In' : 'Sign In'}</span>
            </>
          )}
        </button>
      </div>
      
      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
            onClick={() => setShowAuthModal(false)} 
          />
          <div className="relative w-full max-w-md">
            <WalletAuth 
              onClose={() => setShowAuthModal(false)}
              onAuthSuccess={() => setShowAuthModal(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

