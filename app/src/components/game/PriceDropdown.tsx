'use client';

/**
 * PriceDropdown - Displays detailed price information when clicking the price indicator
 */

import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import SolanaLogo from '@/components/ui/SolanaLogo';

interface PriceDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  price: number | null;
  previousPrice: number | null;
  priceDirection: string;
  isConnected: boolean;
  activeProvider: string | null;
}

export default function PriceDropdown({ 
  isOpen, 
  onClose, 
  price, 
  previousPrice,
  priceDirection,
  isConnected,
  activeProvider 
}: PriceDropdownProps) {
  if (!isOpen) return null;
  
  const priceChange = price && previousPrice ? price - previousPrice : 0;
  const priceChangePercent = price && previousPrice ? ((price - previousPrice) / previousPrice) * 100 : 0;
  
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-black/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-gradient-to-r from-purple-500/10 to-pink-500/10">
          <div className="flex items-center gap-3">
            <SolanaLogo size={32} />
            <div>
              <div className="text-white font-bold">Solana</div>
              <div className="text-white/50 text-xs">SOL/USD</div>
            </div>
          </div>
        </div>
        
        {/* Price */}
        <div className="p-4">
          <div className={`text-3xl font-bold font-mono ${
            priceDirection === 'up' ? 'text-green-400' : 
            priceDirection === 'down' ? 'text-red-400' : 'text-white'
          }`}>
            ${price?.toFixed(2) ?? '---'}
          </div>
          
          <div className={`flex items-center gap-2 mt-1 text-sm ${
            priceChange >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {priceChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span>{priceChange >= 0 ? '+' : ''}{priceChange.toFixed(4)}</span>
            <span className="text-white/40">({priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(3)}%)</span>
          </div>
        </div>
        
        {/* Stats */}
        <div className="px-4 pb-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Status</span>
            <span className={`flex items-center gap-1.5 ${isConnected ? 'text-green-400' : 'text-yellow-400'}`}>
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
              {isConnected ? 'Live' : 'Connecting...'}
            </span>
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Provider</span>
            <span className="text-white/80 capitalize">{activeProvider || 'Auto'}</span>
          </div>
          
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">Update Rate</span>
            <span className="text-white/80">~60/sec</span>
          </div>
        </div>
        
        {/* Footer */}
        <div className="px-4 py-3 bg-white/5 border-t border-white/10">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Activity size={12} />
            <span>Real-time price from {activeProvider || 'WebSocket'}</span>
          </div>
        </div>
      </div>
    </>
  );
}

