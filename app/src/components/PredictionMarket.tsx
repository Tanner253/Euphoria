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
import { GAME_CONFIG } from '@/lib/game/gameConfig';
import { 
  BetControls, 
  GemsModal,
  LeftSidebar,
  RoadmapModal, 
  SplashScreen 
} from '@/components/game';
import WalletAuth from './WalletAuth';
import { Gem } from 'lucide-react';

export default function PredictionMarket() {
  // External hooks
  const { price, previousPrice, isConnected: priceConnected, priceDirection, activeProvider } = useSolanaPrice({ throttleMs: 16 });
  const { tryAutoStart: tryAutoStartMusic } = useArcadeMusic();
  const { demoBalance, updateDemoBalance, updateGemsBalance, isDemoMode, isAuthenticated, gemsBalance } = useWallet();
  
  // UI state
  const [betAmount, setBetAmount] = useState(1);
  const [lastWin, setLastWin] = useState<WinInfo | null>(null);
  const [winAnimation, setWinAnimation] = useState<'entering' | 'visible' | 'exiting' | null>(null);
  const [totalWon, setTotalWon] = useState(0);
  const [totalLost, setTotalLost] = useState(0);
  const [displayPrice, setDisplayPrice] = useState<number | null>(null);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [showGemsModal, setShowGemsModal] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showWalletAuth, setShowWalletAuth] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
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

  // Game engine hook
  const {
    canvasRef,
    volatilityLevel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    isDragging,
    updatePrice,
    zoomIndex,
    cycleZoom,
    zoomLocked,
  } = useGameEngine({
    isMobile,
    balance,
    betAmount,
    sessionId: 'game-session',
    isAuthenticated,
    sidebarWidth,
    onBalanceChange: setBalance,
    onWin: handleWin,
    onTotalWonChange: setTotalWon,
    onTotalLostChange: setTotalLost,
  });

  // Check for mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Update price in game engine
  useEffect(() => {
    if (price !== null) {
      updatePrice(price);
      setDisplayPrice(price);
    }
  }, [price, updatePrice]);

  // Get bet options based on device
  const getBetOptions = useCallback(() => 
    isMobile ? GAME_CONFIG.BET_AMOUNT_OPTIONS_MOBILE : GAME_CONFIG.BET_AMOUNT_OPTIONS, 
  [isMobile]);

  // Canvas event handlers that check for open modals
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (showRoadmap) return;
    handlePointerDown(e);
  }, [showRoadmap, handlePointerDown]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (showRoadmap) return;
    handlePointerMove(e);
  }, [showRoadmap, handlePointerMove]);

  return (
    <div className="relative w-full h-screen overflow-hidden font-sans select-none">
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
        zoomIndex={zoomIndex}
        zoomLocked={zoomLocked}
        isMobile={isMobile}
      />
      
      {/* Game Canvas - offset for sidebar */}
      <div className="absolute inset-0 z-10" style={{ left: sidebarWidth }}>
        <canvas 
          ref={canvasRef}
          className={`block ${isDragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
          style={{ 
            width: `calc(100vw - ${sidebarWidth}px)`, 
            height: '100vh',
            touchAction: 'none'  // Critical for mobile touch handling
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />
      </div>

      {/* Win notification - positioned above winning cell */}
      {lastWin && winAnimation && (
        <div 
          className={`
            absolute pointer-events-none z-50 flex flex-col items-center
            ${winAnimation === 'entering' ? 'win-popup-enter' : ''}
            ${winAnimation === 'visible' ? 'win-popup-visible' : ''}
            ${winAnimation === 'exiting' ? 'win-popup-exit' : ''}
          `}
          style={{ 
            left: Math.min(Math.max(lastWin.screenX + sidebarWidth, 60), window.innerWidth - 60),
            top: Math.max(lastWin.screenY - 70, 10),
          }}
        >
          {/* Sparkle particles */}
          <div className="absolute -inset-4 overflow-visible pointer-events-none">
            {winAnimation === 'visible' && [...Array(8)].map((_, i) => (
              <div
                key={i}
                className="absolute w-1.5 h-1.5 bg-yellow-300 rounded-full"
                style={{
                  left: `${50 + Math.cos(i * Math.PI / 4) * 140}%`,
                  top: `${50 + Math.sin(i * Math.PI / 4) * 140}%`,
                  animation: `sparkle 0.8s ease-out ${i * 0.1}s infinite`,
                  boxShadow: '0 0 6px 2px rgba(253, 224, 71, 0.8)',
                }}
              />
            ))}
          </div>
          
          {/* Main popup bubble */}
          <div 
            className="relative px-4 py-2.5 rounded-2xl flex items-center gap-2"
            style={{
              background: 'linear-gradient(135deg, #4ade80 0%, #22c55e 50%, #16a34a 100%)',
              boxShadow: winAnimation === 'visible' 
                ? '0 0 30px rgba(74, 222, 128, 0.8), 0 0 60px rgba(74, 222, 128, 0.4), inset 0 1px 0 rgba(255,255,255,0.3)'
                : '0 4px 20px rgba(0,0,0,0.3)',
              border: '2px solid rgba(255, 255, 255, 0.4)',
            }}
          >
            <Gem 
              size={isMobile ? 18 : 22} 
              className="text-white" 
              style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.8))' }}
            />
            <span 
              className="font-mono font-black text-white tracking-tight"
              style={{ 
                fontSize: isMobile ? '1.1rem' : '1.25rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.3), 0 0 20px rgba(255,255,255,0.3)',
              }}
            >
              +{lastWin.amount.toFixed(0)}
            </span>
          </div>
          
          {/* Downward pointing triangle (speech bubble tail) */}
          <div 
            className="w-0 h-0"
            style={{ 
              borderLeft: '10px solid transparent',
              borderRight: '10px solid transparent',
              borderTop: '12px solid #22c55e',
              marginTop: '-2px',
              filter: 'drop-shadow(0 4px 3px rgba(0,0,0,0.2))',
            }}
          />
        </div>
      )}

      {/* Bet Controls - positioned at bottom center, accounting for sidebar */}
      <div style={{ left: sidebarWidth }}>
        <BetControls
          betAmount={betAmount}
          onBetAmountChange={setBetAmount}
          betOptions={getBetOptions()}
          isMobile={isMobile}
        />
      </div>

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
    </div>
  );
}
