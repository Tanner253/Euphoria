'use client';

/**
 * PredictionMarket - Main game component
 * Uses extracted components and hooks for better maintainability
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useSolanaPrice } from '@/hooks/useSolanaPrice';
import { useWallet } from '@/contexts/WalletContext';
import { useGameEngine, WinInfo } from '@/hooks/useGameEngine';
import { useArcadeMusic } from '@/hooks/useArcadeMusic';
import { useAutoPlay } from '@/hooks/useAutoPlay';
import { GAME_CONFIG } from '@/lib/game/gameConfig';
import { 
  BetControls, 
  GemsModal,
  GlobalChat,
  LeftSidebar,
  LiveLeaderboard,
  RoadmapModal, 
  SplashScreen 
} from '@/components/game';
import WalletAuth from './WalletAuth';
import { Gem, Bot } from 'lucide-react';

export default function PredictionMarket() {
  // External hooks
  // NORMALIZED: Use Coinbase for consistent price feed across all clients
  // Output at 100ms intervals with smoothing applied
  const { price, previousPrice, isConnected: priceConnected, priceDirection, activeProvider } = useSolanaPrice();
  const { tryAutoStart: tryAutoStartMusic } = useArcadeMusic();
  const { demoBalance, updateDemoBalance, updateGemsBalance, isDemoMode, isAuthenticated, gemsBalance, walletAddress } = useWallet();
  
  // UI state
  const [betAmount, setBetAmount] = useState(1);
  const [lastWin, setLastWin] = useState<WinInfo | null>(null);
  const [winAnimation, setWinAnimation] = useState<'entering' | 'visible' | 'exiting' | null>(null);
  const [totalWon, setTotalWon] = useState(0);
  const [totalLost, setTotalLost] = useState(0);
  const [displayPrice, setDisplayPrice] = useState<number | null>(null);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [showGemsModal, setShowGemsModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showWalletAuth, setShowWalletAuth] = useState(false);
  // Initialize isMobile synchronously to avoid race condition with socket connection
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 640 || (window.innerWidth < 1024 && window.innerHeight > window.innerWidth);
    }
    return false;
  });
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  
  // Balance management - use server balance when authenticated
  const [localBalance, setLocalBalance] = useState<number>(GAME_CONFIG.INITIAL_BALANCE);
  const balance = isAuthenticated ? gemsBalance : (isDemoMode ? demoBalance : localBalance);
  
  const setBalance = useCallback((valueOrUpdater: number | ((prev: number) => number)) => {
    if (typeof valueOrUpdater === 'function') {
      if (isAuthenticated) {
        // Authenticated: update gems balance directly for optimistic UI
        updateGemsBalance(valueOrUpdater(gemsBalance));
      } else if (isDemoMode) {
        updateDemoBalance(valueOrUpdater(demoBalance));
      } else {
        setLocalBalance(prev => valueOrUpdater(prev));
      }
    } else {
      if (isAuthenticated) {
        // Authenticated: update gems balance directly for optimistic UI
        updateGemsBalance(valueOrUpdater);
      } else if (isDemoMode) {
        updateDemoBalance(valueOrUpdater);
      } else {
        setLocalBalance(valueOrUpdater);
      }
    }
  }, [isDemoMode, isAuthenticated, demoBalance, gemsBalance, updateDemoBalance, updateGemsBalance]);

  // Win handler with animation stages
  const handleWin = useCallback((winInfo: WinInfo) => {
    setLastWin(winInfo);
    setWinAnimation('entering');
    
    // Transition to visible after entrance animation
    setTimeout(() => setWinAnimation('visible'), 100);
    
    // Start exit animation
    setTimeout(() => setWinAnimation('exiting'), 1800);
    
    // Clear after exit animation completes
    setTimeout(() => {
      setLastWin(null);
      setWinAnimation(null);
    }, 2500);
  }, []);

  // Sidebar width for canvas offset - no offset on mobile (floating controls)
  const sidebarWidth = isMobile ? 0 : 56;

  // Game engine hook - receives all config from server
  const {
    canvasRef,
    configLoaded,
    serverConfig,
    volatilityLevel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    isDragging: _isDragging,
    updatePrice,
    zoomIndex,
    cycleZoom,
    zoomLocked,
    placeBetAt,
  } = useGameEngine({
    isMobile,
    balance,
    betAmount,
    sessionId: 'game-session',
    isAuthenticated,
    walletAddress,
    isAutoPlaying,
    sidebarWidth,
    onBalanceChange: setBalance,
    onWin: handleWin,
    onTotalWonChange: setTotalWon,
    onTotalLostChange: setTotalLost,
  });
  
  // Auto-play for development testing (only available in NODE_ENV=development)
  const { toggleAutoPlay, canAutoPlay } = useAutoPlay({
    isEnabled: !showSplash && !showWalletAuth && !showRoadmap && !showGemsModal && configLoaded,
    isAutoPlaying,
    setIsAutoPlaying,
    canvasRef,
    currentPrice: price,
    balance,
    betAmount,
    isMobile,
    sidebarWidth,
    zoomIndex,
    serverConfig,  // From server - single source of truth
    onPlaceBet: placeBetAt,
  });

  // Check for mobile - includes portrait tablets/phones
  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Mobile if: narrow screen OR portrait orientation on smaller devices
      const isMobileDevice = width < 640 || (width < 1024 && height > width);
      setIsMobile(isMobileDevice);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  // Update price in game engine
  useEffect(() => {
    if (price !== null) {
      updatePrice(price);
      setDisplayPrice(price);
    }
  }, [price, updatePrice]);

  // Get bet options from server config - only available when connected
  const getBetOptions = useCallback(() => {
    if (!serverConfig) return [1, 5, 10]; // Minimal fallback only for initial render
    return [...(isMobile ? serverConfig.betAmountOptionsMobile : serverConfig.betAmountOptions)];
  }, [isMobile, serverConfig]);

  // Canvas event handlers that check for open modals
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (showRoadmap) return;
    handlePointerDown(e);
  }, [showRoadmap, handlePointerDown]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (showRoadmap) return;
    handlePointerMove(e);
  }, [showRoadmap, handlePointerMove]);

  // Block mobile users - show desktop-only message
  if (isMobile) {
    return (
      <div 
        className="relative w-full flex items-center justify-center font-sans select-none bg-gradient-to-br from-[#1a0a2e] via-[#0a0014] to-[#12001f]"
        style={{ height: '100dvh' }}
      >
        <div className="text-center px-8 max-w-md">
          {/* Icon */}
          <div className="mb-6 flex justify-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 flex items-center justify-center">
              <svg 
                viewBox="0 0 24 24" 
                className="w-10 h-10 text-purple-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
          </div>
          
          {/* Title */}
          <h1 className="text-2xl font-bold text-white mb-3">
            Desktop Only
          </h1>
          
          {/* Message */}
          <p className="text-white/60 text-sm leading-relaxed mb-6">
            Euphoria is optimized for desktop browsers. 
            For the best experience with precise betting controls, 
            please visit us on your computer.
          </p>
          
          {/* URL hint */}
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
            <span className="text-white/40 text-xs">Visit</span>
            <span className="text-purple-400 font-mono text-sm">predicteuphoria.com</span>
          </div>
          
          {/* Coming soon note */}
          <p className="mt-8 text-white/30 text-xs">
            📱 Mobile support coming soon!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden font-sans select-none" style={{ height: '100dvh' }}>
      {/* Left Sidebar Navigation */}
      <LeftSidebar
        displayPrice={displayPrice}
        previousPrice={previousPrice}
        priceDirection={priceDirection}
        priceConnected={priceConnected}
        activeProvider={activeProvider}
        volatilityLevel={volatilityLevel}
        balance={balance}
        totalWon={totalWon}
        totalLost={totalLost}
        onShowRoadmap={() => setShowRoadmap(true)}
        onConnectWallet={() => setShowWalletAuth(true)}
        onCycleZoom={cycleZoom}
        onShowGemsModal={() => setShowGemsModal(true)}
        onShowLeaderboard={() => setShowLeaderboard(true)}
        onShowChat={() => setShowChat(true)}
        zoomIndex={zoomIndex}
        zoomLocked={zoomLocked}
        isMobile={isMobile}
      />
      
      {/* Game Canvas - offset for sidebar */}
      <div className="absolute inset-0 z-10" style={{ left: sidebarWidth }}>
        {/* Only render canvas when server config is loaded */}
        {configLoaded ? (
          <canvas 
            ref={canvasRef}
            className="block cursor-crosshair"
            style={{ 
              width: `calc(100vw - ${sidebarWidth}px)`, 
              height: '100dvh',  // Use dynamic viewport height for mobile browser compatibility
              touchAction: 'none'  // Critical for mobile touch handling
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-pink-300/70 text-sm">Connecting to server...</p>
            </div>
          </div>
        )}
      </div>

      {/* Win notification - Clean minimal style */}
      {lastWin && winAnimation && (
        <div 
          className={`
            absolute pointer-events-none z-50 flex flex-col items-center
            ${winAnimation === 'entering' ? 'win-popup-enter' : ''}
            ${winAnimation === 'exiting' ? 'win-popup-exit' : ''}
          `}
          style={{ 
            left: Math.min(Math.max(lastWin.screenX + sidebarWidth, 70), window.innerWidth - 70),
            top: Math.max(lastWin.screenY - 60, 10),
          }}
        >
          {/* Clean popup */}
          <div 
            className="px-5 py-2.5 rounded-xl flex items-center gap-2"
            style={{
              background: 'linear-gradient(180deg, #4ade80 0%, #22c55e 100%)',
              boxShadow: '0 4px 20px rgba(34, 197, 94, 0.5), 0 2px 8px rgba(0,0,0,0.2)',
              border: '2px solid rgba(255, 255, 255, 0.3)',
            }}
          >
            <Gem 
              size={isMobile ? 18 : 22} 
              className="text-white" 
            />
            <span 
              className="font-mono font-bold text-white"
              style={{ 
                fontSize: isMobile ? '1.2rem' : '1.4rem',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              +{lastWin.amount.toFixed(0)}
            </span>
          </div>
          
          {/* Small triangle pointer */}
          <div 
            style={{ 
              width: 0,
              height: 0,
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: '10px solid #22c55e',
              marginTop: '-1px',
            }}
          />
        </div>
      )}

      {/* Low Volatility Explanation - shows when market is slow */}
      {(volatilityLevel === 'idle' || volatilityLevel === 'low') && (
        <div 
          className="fixed z-40 pointer-events-none animate-pulse"
          style={{ 
            top: isMobile ? '70px' : '20px',
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <div className="bg-black/80 backdrop-blur-md border border-amber-500/40 rounded-xl px-4 py-2 text-center max-w-md">
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-amber-400 text-lg">⏸️</span>
              <span className="text-amber-400 font-bold text-sm uppercase tracking-wider">
                {volatilityLevel === 'idle' ? 'Market Quiet' : 'Low Volume'}
              </span>
            </div>
            <p className="text-white/70 text-xs leading-relaxed">
              {volatilityLevel === 'idle' 
                ? 'Price consolidating — grid slows to prevent easy horizontal wins'
                : 'Low volatility detected — speed reduced for fair gameplay'
              }
            </p>
            <p className="text-cyan-400/60 text-[10px] mt-1">
              Game speeds up when price moves again
            </p>
          </div>
        </div>
      )}

      {/* Bet Controls - fixed centered at bottom, offset for sidebar */}
      <BetControls
        betAmount={betAmount}
        onBetAmountChange={setBetAmount}
        betOptions={getBetOptions()}
        isMobile={isMobile}
        sidebarWidth={sidebarWidth}
      />
      
      {/* Auto-Play Toggle - DEV ONLY */}
      {canAutoPlay && (
        <button
          onClick={toggleAutoPlay}
          className={`
            fixed bottom-24 right-4 z-40 px-4 py-2.5 rounded-xl 
            flex items-center gap-2 font-bold text-sm
            transition-all shadow-lg border-2
            ${isAutoPlaying 
              ? 'bg-green-500/90 border-green-400 text-white shadow-green-500/30 animate-pulse' 
              : 'bg-black/70 border-yellow-500/50 text-yellow-400 hover:bg-black/90 hover:border-yellow-400'
            }
          `}
          title="Auto-Play Demo Mode (DEV ONLY)"
        >
          <Bot size={18} className={isAutoPlaying ? 'animate-bounce' : ''} />
          <span>{isAutoPlaying ? 'AUTO: ON' : 'AUTO: OFF'}</span>
        </button>
      )}
      
      {/* Live Leaderboard Modal */}
      <LiveLeaderboard 
        isOpen={showLeaderboard} 
        onClose={() => setShowLeaderboard(false)} 
      />

      {/* Roadmap Modal */}
      <RoadmapModal 
        isOpen={showRoadmap} 
        onClose={() => setShowRoadmap(false)} 
      />
      
      {/* Gems Exchange Modal */}
      <GemsModal
        isOpen={showGemsModal}
        onClose={() => setShowGemsModal(false)}
        onConnectWallet={() => {
          setShowGemsModal(false);
          setShowWalletAuth(true);
        }}
      />
      
      {/* Splash Screen */}
      {showSplash && (
        <SplashScreen
          onConnectWallet={() => {
            setShowSplash(false);
            setShowWalletAuth(true);
            tryAutoStartMusic(); // Start music on user interaction
          }}
          onSkipToDemo={() => {
            setShowSplash(false);
            tryAutoStartMusic(); // Start music on user interaction
          }}
        />
      )}
      
      {/* Wallet Auth Modal */}
      {showWalletAuth && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
            onClick={() => setShowWalletAuth(false)} 
          />
          <div className="relative w-full max-w-md">
            <WalletAuth 
              onClose={() => setShowWalletAuth(false)}
              onAuthSuccess={() => setShowWalletAuth(false)}
            />
          </div>
        </div>
      )}
      
      {/* Global Chat */}
      <GlobalChat
        walletAddress={walletAddress}
        isOpen={showChat}
        onClose={() => setShowChat(false)}
      />
    </div>
  );
}
