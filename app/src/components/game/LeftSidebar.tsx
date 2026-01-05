'use client';

/**
 * LeftSidebar - Vertical navigation bar on the left side
 * Shows profile when authenticated, plus game controls
 */

import { useState } from 'react';
import { 
  Gem, 
  Map, 
  Github, 
  User,
  LogOut,
  TrendingUp,
  TrendingDown,
  Wallet,
  ChevronRight,
  X,
  ZoomOut,
  Music,
  VolumeX
} from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import { useArcadeMusic } from '@/hooks/useArcadeMusic';
import SolanaLogo from '@/components/ui/SolanaLogo';
import type { VolatilityLevel } from '@/lib/game/gameConfig';

interface LeftSidebarProps {
  // Price data
  displayPrice: number | null;
  previousPrice: number | null;
  priceDirection: string;
  priceConnected: boolean;
  activeProvider: string | null;
  volatilityLevel: VolatilityLevel;
  
  // Balance
  balance: number;
  totalWon: number;
  totalLost: number;
  
  // Actions
  onShowRoadmap: () => void;
  onConnectWallet: () => void;
  onCycleZoom: () => void;
  onShowGemsModal: () => void;
  
  // Zoom
  zoomIndex: number;
  zoomLocked: boolean;
  
  // Responsive
  isMobile: boolean;
}

// Risk levels with their payout multipliers (matches ZOOM_LEVELS: [2.0, 1.0, 0.75])
const RISK_LEVELS = [
  { label: 'Low Risk', payout: '1.6x+', description: '2x zoom - Large cells, easier to win' },
  { label: 'Medium', payout: '2.1x+', description: '1x zoom - Standard cell size' },
  { label: 'High Risk', payout: '3.1x+', description: '0.75x zoom - Small cells, harder to win' },
];

export default function LeftSidebar({
  displayPrice,
  priceDirection,
  priceConnected: _priceConnected,
  volatilityLevel,
  balance,
  totalWon,
  totalLost,
  onShowRoadmap,
  onConnectWallet,
  onCycleZoom,
  onShowGemsModal,
  zoomIndex,
  zoomLocked,
  isMobile,
}: LeftSidebarProps) {
  const { 
    isAuthenticated, 
    walletAddress, 
    gemsBalance, 
    isDemoMode,
    disconnect 
  } = useWallet();
  
  const [showProfile, setShowProfile] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);  // Start collapsed
  const [showPriceTooltip, setShowPriceTooltip] = useState(false);
  const [showRiskTooltip, setShowRiskTooltip] = useState(false);
  
  // Arcade music
  const { isPlaying: isMusicPlaying, toggle: toggleMusic } = useArcadeMusic();
  
  // Suppress unused variable warning (kept for future use)
  void _priceConnected;
  
  // Use server balance if authenticated, otherwise use demo balance
  const displayBalance = isAuthenticated ? gemsBalance : balance;
  
  // Volatility explanation text
  const getVolatilityExplanation = () => {
    switch (volatilityLevel) {
      case 'active':
        return {
          title: 'Market Active',
          description: 'High trading volume. Price updates frequently and bets resolve quickly.',
          color: 'text-green-400',
          bgColor: 'bg-green-500/20 border-green-500/30'
        };
      case 'low':
        return {
          title: 'Low Volume',
          description: 'Trading activity is slow. Price updates may be delayed and bets take longer to resolve.',
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-500/20 border-yellow-500/30'
        };
      case 'idle':
      default:
        return {
          title: 'Market Paused',
          description: 'Very low or no trading volume. This typically happens during off-hours or market closures. Bets cannot be placed until activity resumes.',
          color: 'text-red-400',
          bgColor: 'bg-red-500/20 border-red-500/30'
        };
    }
  };
  
  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };
  
  // On mobile, use a completely different minimal layout
  if (isMobile) {
    return (
      <>
        {/* Mobile Floating Controls - Top Left - pointer-events-none on container so touches pass through */}
        <div className="fixed top-2 left-2 z-40 pointer-events-none">
          {/* Price + Balance Combined Card */}
          <div className="flex gap-2">
            {/* SOL Price - tap for tooltip */}
            <div className="relative">
              <button
                onClick={() => setShowPriceTooltip(!showPriceTooltip)}
                className="pointer-events-auto bg-black/80 backdrop-blur-xl border border-white/20 rounded-xl px-3 py-2 flex items-center gap-2 active:scale-95 transition-transform"
              >
                <div className="relative">
                  <SolanaLogo size={18} />
                  <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                    volatilityLevel === 'active' ? 'bg-green-400' : 
                    volatilityLevel === 'low' ? 'bg-yellow-400' : 'bg-red-400 animate-pulse'
                  }`} />
                </div>
                <span className={`text-sm font-bold font-mono ${
                  priceDirection === 'up' ? 'text-green-400' : 
                  priceDirection === 'down' ? 'text-red-400' : 'text-white'
                }`}>
                  ${displayPrice?.toFixed(2) || '---'}
                </span>
              </button>
              
              {/* Mobile Tooltip */}
              {showPriceTooltip && (
                <div className="pointer-events-auto absolute top-full left-0 mt-2 w-64 p-3 rounded-xl bg-black/95 backdrop-blur-xl border border-white/20 shadow-2xl">
                  <div className={`font-bold text-sm mb-1 ${getVolatilityExplanation().color}`}>
                    {getVolatilityExplanation().title}
                  </div>
                  <p className="text-xs text-white/70 leading-relaxed">
                    {getVolatilityExplanation().description}
                  </p>
                  <button 
                    onClick={() => setShowPriceTooltip(false)}
                    className="mt-2 text-xs text-white/40 hover:text-white/60"
                  >
                    Tap to dismiss
                  </button>
                </div>
              )}
            </div>
            
            {/* Gems Balance */}
            <button
              onClick={onShowGemsModal}
              className="pointer-events-auto bg-black/80 backdrop-blur-xl border border-purple-500/40 rounded-xl px-3 py-2 flex items-center gap-2 active:scale-95 transition-transform"
            >
              <Gem size={16} className="text-purple-400" />
              <span className="text-sm font-bold font-mono text-white">{displayBalance.toFixed(0)}</span>
            </button>
          </div>
        </div>
        
        {/* Mobile Floating Controls - Top Right - pointer-events-none on container */}
        <div className="fixed top-2 right-2 z-40 flex gap-2 pointer-events-none">
          {/* Risk Toggle - HIDDEN on mobile (locked to Low Risk mode) */}
          
          {/* Music Toggle */}
          <button
            onClick={toggleMusic}
            className={`pointer-events-auto w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-transform ${
              isMusicPlaying 
                ? 'bg-purple-500/30 border border-purple-500/40' 
                : 'bg-black/60 border border-white/20'
            }`}
          >
            {isMusicPlaying ? (
              <Music size={18} className="text-purple-400" />
            ) : (
              <VolumeX size={18} className="text-white/40" />
            )}
          </button>
          
          {/* Profile/Connect */}
          {isAuthenticated ? (
            <button
              onClick={() => setShowProfile(true)}
              className="pointer-events-auto w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/30 to-emerald-500/30 border border-green-500/40 flex items-center justify-center active:scale-95 transition-transform"
            >
              <User size={18} className="text-green-400" />
            </button>
          ) : (
            <button
              onClick={onConnectWallet}
              className="pointer-events-auto w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/30 to-pink-500/30 border border-purple-500/40 flex items-center justify-center active:scale-95 transition-transform"
            >
              <Wallet size={18} className="text-purple-400" />
            </button>
          )}
          
          {/* Roadmap */}
          <button
            onClick={onShowRoadmap}
            className="pointer-events-auto w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center active:scale-95 transition-transform"
          >
            <Map size={18} className="text-white" />
          </button>
        </div>
        
        {/* Profile Modal */}
        {showProfile && isAuthenticated && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowProfile(false)} />
            <div className="relative w-full max-w-sm bg-gradient-to-br from-[#1a0a2e] to-[#0a0014] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                    <User size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Your Profile</h3>
                    <p className="text-xs text-white/50 font-mono">{truncateAddress(walletAddress!)}</p>
                  </div>
                </div>
                <button onClick={() => setShowProfile(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                  <X size={18} className="text-white/60" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div className="p-4 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30">
                  <div className="flex items-center justify-between">
                    <span className="text-white/60 text-sm">Gems Balance</span>
                    <div className="flex items-center gap-2">
                      <Gem size={20} className="text-purple-400" />
                      <span className="text-2xl font-bold font-mono text-white">{gemsBalance.toFixed(0)}</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                    <div className="text-xs text-white/50 mb-1">Won</div>
                    <div className="text-lg font-bold font-mono text-green-400">+{totalWon.toFixed(0)}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                    <div className="text-xs text-white/50 mb-1">Lost</div>
                    <div className="text-lg font-bold font-mono text-red-400">-{totalLost.toFixed(0)}</div>
                  </div>
                </div>
                <button
                  onClick={() => { disconnect(); setShowProfile(false); }}
                  className="w-full p-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-medium flex items-center justify-center gap-2"
                >
                  <LogOut size={18} />
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {/* Main Sidebar */}
      <div className={`fixed left-0 top-0 h-full z-40 transition-all duration-300 ${
        isExpanded ? 'w-48' : 'w-14'
      }`}>
        <div className="h-full bg-black/80 backdrop-blur-xl border-r border-white/10 flex flex-col py-3 px-2">
          
          {/* Expand/Collapse Toggle */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="absolute -right-3 top-20 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-white hover:bg-purple-400 transition-colors shadow-lg z-50"
          >
            <ChevronRight size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
          
          {/* Logo / Price with Tooltip */}
          <div className="mb-4 relative">
            <div 
              className={`flex items-center gap-2 p-2 rounded-xl bg-white/5 border border-white/10 cursor-help ${!isExpanded && 'justify-center'}`}
              onMouseEnter={() => setShowPriceTooltip(true)}
              onMouseLeave={() => setShowPriceTooltip(false)}
            >
              <div className="relative">
                <SolanaLogo size={isExpanded ? 20 : 24} />
                <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                  volatilityLevel === 'active' ? 'bg-green-400 animate-pulse' : 
                  volatilityLevel === 'low' ? 'bg-yellow-400' : 
                  'bg-red-400 animate-pulse'
                }`} />
              </div>
              {isExpanded && (
                <div className="flex flex-col">
                  <span className={`text-sm font-bold font-mono ${
                    priceDirection === 'up' ? 'text-green-400' : 
                    priceDirection === 'down' ? 'text-red-400' : 'text-white'
                  }`}>
                    {displayPrice ? `$${displayPrice.toFixed(2)}` : '---'}
                  </span>
                  <span className={`text-[10px] ${
                    volatilityLevel === 'active' ? 'text-green-400' :
                    volatilityLevel === 'low' ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {volatilityLevel === 'active' ? '● ACTIVE' : volatilityLevel === 'low' ? '● SLOW' : '● PAUSED'}
                  </span>
                </div>
              )}
            </div>
            
            {/* Price Status Tooltip */}
            {showPriceTooltip && (
              <div className="absolute left-full ml-2 top-0 w-64 p-3 rounded-xl bg-black/95 backdrop-blur-xl border border-white/20 shadow-2xl z-50">
                <div className={`font-bold text-sm mb-2 ${getVolatilityExplanation().color}`}>
                  {getVolatilityExplanation().title}
                </div>
                <p className="text-xs text-white/70 leading-relaxed mb-3">
                  {getVolatilityExplanation().description}
                </p>
                <div className="space-y-2 pt-2 border-t border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400" />
                    <span className="text-[10px] text-white/60"><b className="text-green-400">ACTIVE</b> - High volume, fast price updates</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span className="text-[10px] text-white/60"><b className="text-yellow-400">SLOW</b> - Low volume, delayed updates</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="text-[10px] text-white/60"><b className="text-red-400">PAUSED</b> - No trades, market closed</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Balance Section - Clickable to open Gems Modal */}
          <button
            onClick={onShowGemsModal}
            className={`mb-4 p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 hover:border-purple-400/50 hover:from-purple-500/30 hover:to-pink-500/30 transition-all w-full ${!isExpanded && 'flex justify-center'}`}
            title="Buy or sell gems"
          >
            <div className={`flex items-center gap-2 ${!isExpanded && 'flex-col'}`}>
              <Gem size={isExpanded ? 18 : 22} className="text-purple-400" />
              {isExpanded ? (
                <div className="flex flex-col items-start">
                  <span className="text-lg font-bold font-mono text-white">{displayBalance.toFixed(0)}</span>
                  <span className="text-[10px] text-purple-300/70">{isDemoMode ? 'DEMO' : 'Click to trade'}</span>
                </div>
              ) : (
                <span className="text-xs font-bold font-mono text-white">{displayBalance.toFixed(0)}</span>
              )}
            </div>
          </button>
          
          {/* Stats Section */}
          {isExpanded && (
            <div className="mb-4 p-2 rounded-xl bg-white/5 border border-white/10 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/50 flex items-center gap-1">
                  <TrendingUp size={12} className="text-green-400" />
                  Won
                </span>
                <span className="text-green-400 font-mono">+{totalWon.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/50 flex items-center gap-1">
                  <TrendingDown size={12} className="text-red-400" />
                  Lost
                </span>
                <span className="text-red-400 font-mono">-{totalLost.toFixed(0)}</span>
              </div>
            </div>
          )}
          
          {/* Profile / Connect Button */}
          {isAuthenticated ? (
            <button
              onClick={() => setShowProfile(true)}
              className={`mb-2 p-2 rounded-xl bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 hover:border-green-400/50 transition-all ${!isExpanded && 'flex justify-center'}`}
            >
              <div className={`flex items-center gap-2 ${!isExpanded && 'flex-col'}`}>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                  <User size={16} className="text-white" />
                </div>
                {isExpanded && (
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium text-white">Profile</span>
                    <span className="text-[10px] text-white/50 font-mono">{truncateAddress(walletAddress!)}</span>
                  </div>
                )}
              </div>
            </button>
          ) : (
            <button
              onClick={onConnectWallet}
              className={`mb-2 p-2 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 hover:border-purple-400/50 transition-all ${!isExpanded && 'flex justify-center'}`}
            >
              <div className={`flex items-center gap-2 ${!isExpanded && 'flex-col'}`}>
                <Wallet size={isExpanded ? 18 : 22} className="text-purple-400" />
                {isExpanded && <span className="text-xs font-medium text-white">Connect</span>}
              </div>
            </button>
          )}
          
          {/* Spacer */}
          <div className="flex-1" />
          
          {/* Action Buttons */}
          <div className="space-y-2">
            {/* Risk Level Button */}
            <div className="relative">
              <button
                onClick={onCycleZoom}
                disabled={zoomLocked}
                onMouseEnter={() => setShowRiskTooltip(true)}
                onMouseLeave={() => setShowRiskTooltip(false)}
                className={`w-full p-2 rounded-xl transition-all ${!isExpanded && 'flex justify-center'} ${
                  zoomLocked 
                    ? 'bg-gray-500/10 border border-gray-500/20 cursor-not-allowed opacity-50' 
                    : zoomIndex === 0 ? 'bg-green-500/20 hover:bg-green-500/30 border border-green-500/30'
                    : zoomIndex === 1 ? 'bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30'
                    : 'bg-red-500/20 hover:bg-red-500/30 border border-red-500/30'
                }`}
              >
                <div className={`flex items-center gap-2 ${!isExpanded && 'flex-col'}`}>
                  <ZoomOut size={isExpanded ? 16 : 20} className={
                    zoomLocked ? "text-gray-500" 
                    : zoomIndex === 0 ? "text-green-400"
                    : zoomIndex === 1 ? "text-yellow-400"
                    : "text-red-400"
                  } />
                  {isExpanded && (
                    <div className="flex flex-col items-start">
                      <span className={`text-xs font-semibold ${
                        zoomLocked ? 'text-gray-500' 
                        : zoomIndex === 0 ? 'text-green-400'
                        : zoomIndex === 1 ? 'text-yellow-400'
                        : 'text-red-400'
                      }`}>
                        {zoomLocked ? 'Locked' : RISK_LEVELS[zoomIndex].label}
                      </span>
                      <span className={`text-[10px] ${zoomLocked ? 'text-gray-500/70' : 'text-white/50'}`}>
                        {zoomLocked ? 'Bets active' : RISK_LEVELS[zoomIndex].payout}
                      </span>
                    </div>
                  )}
                </div>
              </button>
              
              {/* Risk Level Tooltip - positioned above */}
              {showRiskTooltip && !zoomLocked && (
                <div className="absolute bottom-full mb-2 left-0 w-64 p-3 rounded-xl bg-black/95 backdrop-blur-xl border border-white/20 shadow-2xl z-50">
                  <div className="font-bold text-sm text-white mb-2">Risk Levels</div>
                  <div className="space-y-2">
                    {RISK_LEVELS.map((level, idx) => (
                      <div 
                        key={idx}
                        className={`p-2 rounded-lg border ${
                          idx === zoomIndex 
                            ? idx === 0 ? 'bg-green-500/20 border-green-500/40' 
                              : idx === 1 ? 'bg-yellow-500/20 border-yellow-500/40'
                              : 'bg-red-500/20 border-red-500/40'
                            : 'bg-white/5 border-white/10'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className={`text-xs font-semibold ${
                            idx === 0 ? 'text-green-400' : idx === 1 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {level.label}
                          </span>
                          <span className="text-xs text-white/70 font-mono">{level.payout}</span>
                        </div>
                        <p className="text-[10px] text-white/50 mt-1">{level.description}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-white/40 mt-2">Click to cycle through risk levels</p>
                </div>
              )}
            </div>
            
            {/* Roadmap */}
            <button
              onClick={onShowRoadmap}
              className={`w-full p-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 transition-all ${!isExpanded && 'flex justify-center'}`}
            >
              <div className={`flex items-center gap-2 ${!isExpanded && 'flex-col'}`}>
                <Map size={isExpanded ? 16 : 20} className="text-white" />
                {isExpanded && <span className="text-xs font-semibold text-white">Roadmap</span>}
              </div>
            </button>
            
            {/* Music Toggle */}
            <button
              onClick={toggleMusic}
              className={`w-full p-2 rounded-xl transition-all ${!isExpanded && 'flex justify-center'} ${
                isMusicPlaying 
                  ? 'bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30' 
                  : 'bg-white/5 hover:bg-white/10 border border-white/10'
              }`}
              title={isMusicPlaying ? 'Mute Music' : 'Play Music'}
            >
              <div className={`flex items-center gap-2 ${!isExpanded && 'flex-col'}`}>
                {isMusicPlaying ? (
                  <Music size={isExpanded ? 16 : 20} className="text-purple-400" />
                ) : (
                  <VolumeX size={isExpanded ? 16 : 20} className="text-white/40" />
                )}
                {isExpanded && (
                  <span className={`text-xs font-medium ${isMusicPlaying ? 'text-purple-400' : 'text-white/40'}`}>
                    {isMusicPlaying ? 'Music On' : 'Music Off'}
                  </span>
                )}
              </div>
            </button>
            
            {/* Social Links */}
            <div className={`flex ${isExpanded ? 'gap-2' : 'flex-col gap-2'} pt-2 border-t border-white/10`}>
              <a 
                href="https://github.com/Tanner253/Euphoria" 
                target="_blank"
                rel="noopener noreferrer"
                className={`${isExpanded ? 'flex-1' : 'w-full'} p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white border border-white/10 transition-all flex items-center justify-center`}
                title="GitHub"
              >
                <Github size={16} />
              </a>
              <a 
                href="https://x.com/i/communities/2007261746566967730/" 
                target="_blank"
                rel="noopener noreferrer"
                className={`${isExpanded ? 'flex-1' : 'w-full'} p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white border border-white/10 transition-all flex items-center justify-center`}
                title="X Community"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
      
      {/* Profile Modal */}
      {showProfile && isAuthenticated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowProfile(false)} />
          <div className="relative w-full max-w-sm bg-gradient-to-br from-[#1a0a2e] to-[#0a0014] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                  <User size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-white">Your Profile</h3>
                  <p className="text-xs text-white/50 font-mono">{truncateAddress(walletAddress!)}</p>
                </div>
              </div>
              <button onClick={() => setShowProfile(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                <X size={18} className="text-white/60" />
              </button>
            </div>
            
            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Balance Card */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30">
                <div className="flex items-center justify-between">
                  <span className="text-white/60 text-sm">Gems Balance</span>
                  <div className="flex items-center gap-2">
                    <Gem size={20} className="text-purple-400" />
                    <span className="text-2xl font-bold font-mono text-white">{gemsBalance.toFixed(0)}</span>
                  </div>
                </div>
              </div>
              
              {/* Session Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                  <div className="text-xs text-white/50 mb-1">Session Won</div>
                  <div className="text-lg font-bold font-mono text-green-400">+{totalWon.toFixed(0)}</div>
                </div>
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="text-xs text-white/50 mb-1">Session Lost</div>
                  <div className="text-lg font-bold font-mono text-red-400">-{totalLost.toFixed(0)}</div>
                </div>
              </div>
              
              {/* Wallet Address */}
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="text-xs text-white/50 mb-1">Wallet Address</div>
                <div className="text-sm font-mono text-white break-all">{walletAddress}</div>
              </div>
              
              {/* Disconnect Button */}
              <button
                onClick={() => {
                  disconnect();
                  setShowProfile(false);
                }}
                className="w-full p-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-medium flex items-center justify-center gap-2 transition-all"
              >
                <LogOut size={18} />
                Disconnect Wallet
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

