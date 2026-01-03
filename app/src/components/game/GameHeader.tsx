'use client';

/**
 * GameHeader - Top bar with price indicator, balance, and controls
 */

import { Gem, ChevronDown, Map, RefreshCw, Plus, Github } from 'lucide-react';
import SolanaLogo from '@/components/ui/SolanaLogo';
import PriceDropdown from './PriceDropdown';
import WalletButton from '@/components/WalletButton';
import type { VolatilityLevel } from '@/lib/game/gameConfig';

interface GameHeaderProps {
  // Price data
  displayPrice: number | null;
  previousPrice: number | null;
  priceDirection: string;
  priceConnected: boolean;
  activeProvider: string | null;
  volatilityLevel: VolatilityLevel;
  
  // Price dropdown
  showPriceDropdown: boolean;
  onTogglePriceDropdown: () => void;
  onClosePriceDropdown: () => void;
  
  // Balance
  balance: number;
  totalWon: number;
  totalLost: number;
  lastWin: { amount: number; id: string } | null;
  
  // Actions
  onShowRoadmap: () => void;
  onResetGame: () => void;
  
  // Responsive
  isMobile: boolean;
}

export default function GameHeader({
  displayPrice,
  previousPrice,
  priceDirection,
  priceConnected,
  activeProvider,
  volatilityLevel,
  showPriceDropdown,
  onTogglePriceDropdown,
  onClosePriceDropdown,
  balance,
  totalWon,
  totalLost,
  lastWin,
  onShowRoadmap,
  onResetGame,
  isMobile,
}: GameHeaderProps) {
  return (
    <>
      {/* Price Indicator with Dropdown - Top Left */}
      <div className="absolute top-2 sm:top-4 left-2 sm:left-4 pointer-events-none">
        <button
          onClick={onTogglePriceDropdown}
          className="relative flex items-center gap-1.5 sm:gap-2 bg-black/80 backdrop-blur-xl border border-white/10 rounded-full px-2.5 sm:px-4 py-1.5 sm:py-2 pointer-events-auto hover:bg-black/90 transition-all"
        >
          <SolanaLogo size={isMobile ? 16 : 20} />
          <span className={`text-sm sm:text-lg font-bold font-mono ${
            priceDirection === 'up' ? 'text-green-400' : 
            priceDirection === 'down' ? 'text-red-400' : 'text-white'
          }`}>
            {displayPrice ? `$${displayPrice.toFixed(2)}` : '---'}
          </span>
          <ChevronDown size={isMobile ? 12 : 16} className={`text-white/50 transition-transform ${showPriceDropdown ? 'rotate-180' : ''}`} />
          
          {/* Connection indicator */}
          <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${priceConnected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
        </button>
        
        <PriceDropdown 
          isOpen={showPriceDropdown}
          onClose={onClosePriceDropdown}
          price={displayPrice}
          previousPrice={previousPrice}
          priceDirection={priceDirection}
          isConnected={priceConnected}
          activeProvider={activeProvider}
        />
        
        {/* Volatility indicator - hidden on mobile */}
        <div className={`hidden sm:flex mt-2 text-xs font-mono items-center gap-2 px-3 py-1 rounded-full ${
          volatilityLevel === 'active' ? 'text-green-400 bg-green-400/10' :
          volatilityLevel === 'low' ? 'text-yellow-400 bg-yellow-400/10' :
          'text-red-400 bg-red-400/10'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            volatilityLevel === 'active' ? 'bg-green-400' :
            volatilityLevel === 'low' ? 'bg-yellow-400' :
            'bg-red-400'
          }`}></span>
          {volatilityLevel === 'active' ? 'ACTIVE' : volatilityLevel === 'low' ? 'SLOW' : 'PAUSED'}
        </div>
      </div>

      {/* Top Right Controls */}
      <div className="absolute top-2 sm:top-4 right-2 sm:right-4 flex items-center gap-1.5 sm:gap-2">
        {/* Balance */}
        <div className="bg-black/60 backdrop-blur-xl border border-white/10 rounded-xl sm:rounded-2xl px-2.5 sm:px-4 py-1.5 sm:py-2 flex items-center gap-1.5 sm:gap-2">
          <Gem size={isMobile ? 14 : 18} className="text-purple-400" />
          <span className="text-sm sm:text-lg font-bold font-mono text-white">{balance.toFixed(0)}</span>
        </div>
        
        {/* Stats - hidden on mobile */}
        <div className="hidden lg:flex bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl px-3 py-2 gap-3 text-xs">
          <span className="text-green-400 font-mono">+{totalWon.toFixed(0)}</span>
          <span className="text-red-400 font-mono">-{totalLost.toFixed(0)}</span>
        </div>
        
        {/* Wallet Button - x403 Auth */}
        <WalletButton compact={isMobile} />
        
        {/* Roadmap Button */}
        <button 
          onClick={onShowRoadmap}
          className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 rounded-lg sm:rounded-xl text-white text-xs sm:text-sm font-semibold shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all"
        >
          <Map size={isMobile ? 14 : 18} />
          <span className="hidden sm:inline">Roadmap</span>
          <span className="hidden lg:inline px-1.5 py-0.5 bg-white/20 rounded text-[10px] font-bold uppercase">New</span>
        </button>
        
        {/* Reset Button */}
        <button 
          onClick={onResetGame}
          className="p-1.5 sm:p-2 bg-white/5 hover:bg-white/10 rounded-lg sm:rounded-xl text-white/60 hover:text-white border border-white/10 transition-all"
          title="Reset Game"
        >
          <RefreshCw size={isMobile ? 14 : 18} />
        </button>
      </div>
        
      {/* Win notification */}
      {lastWin && (
        <div className="absolute top-16 sm:top-24 left-2 sm:left-4 animate-bounce bg-gradient-to-r from-green-500 to-emerald-400 text-white font-bold py-1.5 sm:py-2 px-3 sm:px-4 rounded-lg sm:rounded-xl shadow-2xl shadow-green-500/30 flex items-center gap-1.5 sm:gap-2 pointer-events-none">
          <Plus size={isMobile ? 12 : 16} />
          <span className="font-mono text-sm sm:text-base">+{lastWin.amount.toFixed(0)} 💎</span>
        </div>
      )}

      {/* Social Links - Bottom Left */}
      <div className="absolute bottom-16 sm:bottom-4 left-2 sm:left-4 flex items-center gap-1.5 sm:gap-2">
        <a 
          href="https://github.com/Tanner253/Euphoria" 
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 sm:p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white border border-white/10 transition-all"
          title="View on GitHub"
        >
          <Github size={isMobile ? 14 : 16} />
        </a>
        <a 
          href="https://x.com/i/communities/2007261746566967730/" 
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 sm:p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white border border-white/10 transition-all"
          title="Join X Community"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
      </div>
    </>
  );
}

