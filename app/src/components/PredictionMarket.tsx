'use client';

/**
 * PredictionMarket - Main game component
 * Uses extracted components and hooks for better maintainability
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useSolanaPrice } from '@/hooks/useSolanaPrice';
import { useWallet } from '@/contexts/WalletContext';
import { useGameEngine } from '@/hooks/useGameEngine';
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
import { Plus } from 'lucide-react';

export default function PredictionMarket() {
  // External hooks
  const { price, previousPrice, isConnected: priceConnected, priceDirection, activeProvider } = useSolanaPrice({ throttleMs: 16 });
  const { tryAutoStart: tryAutoStartMusic } = useArcadeMusic();
  const { demoBalance, updateDemoBalance, updateGemsBalance, isDemoMode, isAuthenticated, gemsBalance, refreshBalance } = useWallet();
  
  // UI state
  const [betAmount, setBetAmount] = useState(1);
  const [lastWin, setLastWin] = useState<{ amount: number; id: string } | null>(null);
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

  // Win handler with timeout
  const handleWin = useCallback((winInfo: { amount: number; id: string }) => {
    setLastWin(winInfo);
    setTimeout(() => setLastWin(null), 2500);
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
    onRefreshBalance: refreshBalance,
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
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />
      </div>

      {/* Win notification */}
      {lastWin && (
        <div 
          className="absolute top-4 animate-bounce bg-gradient-to-r from-green-500 to-emerald-400 text-white font-bold py-2 px-4 rounded-xl shadow-2xl shadow-green-500/30 flex items-center gap-2 pointer-events-none z-30"
          style={{ left: sidebarWidth + 16 }}
        >
          <Plus size={16} />
          <span className="font-mono">+{lastWin.amount.toFixed(0)} 💎</span>
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
