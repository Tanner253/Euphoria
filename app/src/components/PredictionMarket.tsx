'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Plus, Minus, Gem, ChevronDown, Map, X, Rocket, Wallet, Shield, Coins, Zap, Globe, Check, Circle, Github, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { useSolanaPrice } from '@/hooks/useSolanaPrice';

// Game Configuration
const CONFIG = {
  CELL_SIZE: 50,
  CELL_SIZE_MOBILE: 40,
  GRID_SPEED_ACTIVE: 0.8,
  GRID_SPEED_IDLE: 0.08,
  PRICE_SCALE: 2500,
  PRICE_SMOOTHING: 0.08,
  FLATLINE_THRESHOLD: 0.002,
  FLATLINE_WINDOW: 90,
  BET_AMOUNT_OPTIONS: [5, 10, 25, 50, 100],
  BET_AMOUNT_OPTIONS_MOBILE: [5, 10, 25],
  INITIAL_BALANCE: 1000,
  WIN_COLOR: '#c8e64c',
  LOSS_COLOR: '#ef4444',
  BG_COLOR: '#0a0014',
  GRID_LINE_COLOR: 'rgba(255, 100, 150, 0.12)',
  GRID_DOT_COLOR: 'rgba(255, 100, 150, 0.35)',
  PRICE_LINE_COLOR: '#ff66aa',
  PRICE_LINE_GLOW: '#ff99cc',
  MIN_BET_COLUMNS_AHEAD: 4,
  PRICE_AXIS_WIDTH: 80,
  PRICE_AXIS_WIDTH_MOBILE: 60,
  HEAD_X: 180,
  HEAD_X_MOBILE: 100,
  VERTICAL_CELLS: 30,
};

// Solana Logo SVG Component
const SolanaLogo = ({ size = 20, className = "" }: { size?: number; className?: string }) => (
  <svg 
    viewBox="0 0 397.7 311.7" 
    width={size} 
    height={size} 
    className={className}
  >
    <linearGradient id="solana-gradient" x1="360.879" y1="351.455" x2="141.213" y2="-69.294" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#00FFA3"/>
      <stop offset="1" stopColor="#DC1FFF"/>
    </linearGradient>
    <path fill="url(#solana-gradient)" d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z"/>
    <path fill="url(#solana-gradient)" d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z"/>
    <path fill="url(#solana-gradient)" d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z"/>
  </svg>
);

interface Bet {
  id: string;
  colId: string;
  yIndex: number;
  amount: number;
  multiplier: number;
  status: 'pending' | 'won' | 'lost';
}

interface Column {
  id: string;
  x: number;
  cells: Record<number, { id: string; multiplier: string }>;
  centerIndex: number;
}

interface GameState {
  offsetX: number;
  priceY: number;
  targetPriceY: number;
  priceHistory: Array<{ x: number; y: number }>;
  columns: Column[];
  bets: Bet[];
  lastGenX: number;
  cameraY: number;
  initialized: boolean;
  recentPrices: number[];
  currentSpeed: number;
  lastPrice: number | null;
}

const getY = (index: number) => index * CONFIG.CELL_SIZE;
const getCellIndexForPrice = (priceY: number): number => {
  return Math.floor((priceY + CONFIG.CELL_SIZE / 2) / CONFIG.CELL_SIZE);
};

const calculateMultiplier = (yIndex: number, currentPriceIndex: number): string => {
  const dist = Math.abs(yIndex - currentPriceIndex);
  let mult = 1.1 + Math.pow(dist, 1.3) * 0.2;
  mult = mult * 0.98;
  return Math.min(Math.max(mult, 1.01), 50.0).toFixed(2);
};

// Price Dropdown Component
function PriceDropdown({ 
  isOpen, 
  onClose, 
  price, 
  previousPrice,
  priceDirection,
  isConnected,
  activeProvider 
}: { 
  isOpen: boolean;
  onClose: () => void;
  price: number | null;
  previousPrice: number | null;
  priceDirection: string;
  isConnected: boolean;
  activeProvider: string | null;
}) {
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

// Roadmap Component
function RoadmapModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [activePhase, setActivePhase] = useState(0);
  
  const phases = [
    {
      id: 0,
      title: "Phase 1: Foundation",
      status: "current",
      icon: Rocket,
      color: "from-green-500 to-emerald-400",
      items: [
        { text: "Real-time SOL/USD price feed", done: true },
        { text: "Demo mode with 1,000 free gems", done: true },
        { text: "Smooth price-action betting grid", done: true },
        { text: "Dynamic volatility-based scroll speed", done: true },
        { text: "Click & drag bet placement", done: true },
      ]
    },
    {
      id: 1,
      title: "Phase 2: Web3 Integration",
      status: "upcoming",
      icon: Wallet,
      color: "from-purple-500 to-pink-500",
      items: [
        { text: "Phantom Wallet sign-in", done: false },
        { text: "x402/x403 no-KYC authentication", done: false },
        { text: "SOL → Gems deposit system", done: false },
        { text: "On-chain transaction verification", done: false },
        { text: "Secure wallet session management", done: false },
      ]
    },
    {
      id: 2,
      title: "Phase 3: Economy",
      status: "planned",
      icon: Coins,
      color: "from-yellow-500 to-orange-500",
      items: [
        { text: "Gems → SOL withdrawal (5% platform fee)", done: false },
        { text: "Instant cashout to connected wallet", done: false },
        { text: "Transaction history & receipts", done: false },
        { text: "Daily/weekly bonus gems", done: false },
        { text: "Referral rewards program", done: false },
      ]
    },
    {
      id: 3,
      title: "Phase 4: Social & Compete",
      status: "planned",
      icon: Globe,
      color: "from-blue-500 to-cyan-400",
      items: [
        { text: "Global leaderboards", done: false },
        { text: "Live player activity feed", done: false },
        { text: "Tournaments & competitions", done: false },
        { text: "Achievement badges & NFTs", done: false },
        { text: "Social sharing integration", done: false },
      ]
    },
    {
      id: 4,
      title: "Phase 5: Advanced",
      status: "future",
      icon: Zap,
      color: "from-red-500 to-pink-600",
      items: [
        { text: "Multiple trading pairs (BTC, ETH)", done: false },
        { text: "Custom bet multiplier ranges", done: false },
        { text: "Mobile native apps", done: false },
        { text: "API for third-party integration", done: false },
        { text: "DAO governance token", done: false },
      ]
    },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-4xl max-h-[95vh] overflow-hidden bg-gradient-to-br from-[#1a0a2e] to-[#0a0014] border border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl">
        {/* Header */}
        <div className="relative p-4 sm:p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-1.5 sm:p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg sm:rounded-xl">
                <Map size={20} className="text-white sm:w-6 sm:h-6" />
              </div>
              <div>
                <h2 className="text-lg sm:text-2xl font-bold text-white">Euphoria Roadmap</h2>
                <p className="text-white/50 text-xs sm:text-sm hidden sm:block">Building the future of prediction markets</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
              <X size={20} className="text-white/60 sm:w-6 sm:h-6" />
            </button>
          </div>
          
          {/* Phase tabs - scrollable on mobile */}
          <div className="flex gap-2 mt-4 sm:mt-6 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
            {phases.map((phase, i) => (
              <button
                key={phase.id}
                onClick={() => setActivePhase(i)}
                className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                  activePhase === i 
                    ? `bg-gradient-to-r ${phase.color} text-white shadow-lg` 
                    : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                <phase.icon size={14} className="sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">{phase.title.split(': ')[0]}</span>
                <span className="sm:hidden">P{phase.id + 1}</span>
              </button>
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto max-h-[50vh] sm:max-h-[60vh]">
          {/* Launch Requirement Banner */}
          <div className="mb-4 sm:mb-6 p-4 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-xl sm:rounded-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg flex-shrink-0">
                <Rocket size={20} className="text-amber-400" />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm sm:text-base mb-1 flex items-center gap-2">
                  🚀 Real Money Launch Goal
                  <span className="px-2 py-0.5 bg-amber-500/30 text-amber-300 text-[10px] font-bold rounded-full uppercase">Important</span>
                </h4>
                <p className="text-white/70 text-xs sm:text-sm mb-2">
                  Real SOL deposits and withdrawals will launch once we hit <span className="text-amber-400 font-bold">3,500 Creator Rewards</span> on X. 
                  This ensures our custodial wallet can cover payouts for big winners.
                </p>
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex-1 h-2 bg-black/30 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full" style={{ width: '15%' }} />
                  </div>
                  <span className="text-amber-400 text-xs font-mono font-bold">~500 / 3,500</span>
                </div>
                <p className="text-white/50 text-[10px] sm:text-xs mt-2">
                  Join our X Community to help us reach this goal and be first to play for real!
                </p>
              </div>
            </div>
          </div>
          
          {phases.map((phase, i) => (
            <div key={phase.id} className={`transition-all duration-300 ${activePhase === i ? 'block' : 'hidden'}`}>
              <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
                <div className={`p-2.5 sm:p-4 bg-gradient-to-br ${phase.color} rounded-xl sm:rounded-2xl shadow-lg`}>
                  <phase.icon size={24} className="text-white sm:w-8 sm:h-8" />
                </div>
                <div>
                  <h3 className="text-base sm:text-xl font-bold text-white">{phase.title}</h3>
                  <div className={`inline-flex items-center gap-1.5 mt-1 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold uppercase ${
                    phase.status === 'current' ? 'bg-green-500/20 text-green-400' :
                    phase.status === 'upcoming' ? 'bg-purple-500/20 text-purple-400' :
                    phase.status === 'planned' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-white/10 text-white/50'
                  }`}>
                    {phase.status === 'current' && <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />}
                    {phase.status}
                  </div>
                </div>
              </div>
              
              <div className="space-y-2 sm:space-y-3">
                {phase.items.map((item, j) => (
                  <div 
                    key={j}
                    className={`flex items-center gap-2 sm:gap-3 p-3 sm:p-4 rounded-lg sm:rounded-xl transition-all ${
                      item.done 
                        ? 'bg-green-500/10 border border-green-500/20' 
                        : 'bg-white/5 border border-white/5'
                    }`}
                  >
                    <div className={`flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center ${
                      item.done ? 'bg-green-500 text-white' : 'bg-white/10 text-white/30'
                    }`}>
                      {item.done ? <Check size={12} className="sm:w-3.5 sm:h-3.5" /> : <Circle size={12} className="sm:w-3.5 sm:h-3.5" />}
                    </div>
                    <span className={`text-sm sm:text-base ${item.done ? 'text-white' : 'text-white/60'}`}>
                      {item.text}
                    </span>
                    {item.done && (
                      <span className="ml-auto text-[10px] sm:text-xs text-green-400 font-medium">LIVE</span>
                    )}
                  </div>
                ))}
              </div>
              
              {phase.id === 1 && (
                <>
                  <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg sm:rounded-xl">
                    <div className="flex items-start gap-2 sm:gap-3">
                      <Shield size={18} className="text-purple-400 flex-shrink-0 mt-0.5 sm:w-5 sm:h-5" />
                      <div>
                        <h4 className="font-bold text-white text-sm sm:text-base mb-1">No-KYC Authentication</h4>
                        <p className="text-white/60 text-xs sm:text-sm">
                          Using x403 protocol for privacy-preserving authentication. Your keys, your coins, your privacy.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 p-3 sm:p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg sm:rounded-xl">
                    <div className="flex items-start gap-2 sm:gap-3">
                      <Coins size={18} className="text-amber-400 flex-shrink-0 mt-0.5 sm:w-5 sm:h-5" />
                      <div>
                        <h4 className="font-bold text-white text-sm sm:text-base mb-1">Launch Requirement</h4>
                        <p className="text-white/60 text-xs sm:text-sm">
                          Phase 2 begins when we reach 3,500 X Creator Rewards. This funds the custodial wallet to guarantee all payouts.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
              
              {phase.id === 2 && (
                <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg sm:rounded-xl">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <Coins size={18} className="text-yellow-400 flex-shrink-0 mt-0.5 sm:w-5 sm:h-5" />
                    <div>
                      <h4 className="font-bold text-white text-sm sm:text-base mb-1">5% Platform Fee</h4>
                      <p className="text-white/60 text-xs sm:text-sm">
                        A 5% fee on withdrawals supports platform operations. Deposits are always free.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        
        {/* Footer */}
        <div className="p-4 sm:p-6 border-t border-white/10 bg-black/20">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-white/40 text-xs sm:text-sm text-center sm:text-left">
              Built on Solana • Real-time price feeds
            </div>
            <div className="flex gap-2">
              <a 
                href="https://github.com/Tanner253/Euphoria" 
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg sm:rounded-xl text-white/60 hover:text-white text-xs sm:text-sm font-medium transition-all"
              >
                <Github size={14} className="sm:w-4 sm:h-4" />
                GitHub
              </a>
              <a 
                href="https://x.com/i/communities/2007261746566967730/" 
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg sm:rounded-xl text-white text-xs sm:text-sm font-medium hover:opacity-90 transition-all"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                <span className="hidden sm:inline">Join Community</span>
                <span className="sm:hidden">Join</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PredictionMarket() {
  const { price, previousPrice, isConnected: priceConnected, priceDirection, activeProvider } = useSolanaPrice({ throttleMs: 16 });
  
  const [balance, setBalance] = useState(CONFIG.INITIAL_BALANCE);
  const [betAmount, setBetAmount] = useState(5);
  const [lastWin, setLastWin] = useState<{ amount: number; id: string } | null>(null);
  const [totalWon, setTotalWon] = useState(0);
  const [totalLost, setTotalLost] = useState(0);
  const [displayPrice, setDisplayPrice] = useState<number | null>(null);
  const [volatilityLevel, setVolatilityLevel] = useState<'active' | 'low' | 'idle'>('active');
  const [isDragging, setIsDragging] = useState(false);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [showPriceDropdown, setShowPriceDropdown] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [, forceUpdate] = useState(0);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const basePriceRef = useRef<number | null>(null);
  const priceRef = useRef<number | null>(null);
  const balanceRef = useRef(CONFIG.INITIAL_BALANCE);
  const betAmountRef = useRef(5);
  const lastBetCellRef = useRef<string | null>(null);
  
  const stateRef = useRef<GameState>({
    offsetX: 0,
    priceY: 0,
    targetPriceY: 0,
    priceHistory: [],
    columns: [],
    bets: [],
    lastGenX: 0,
    cameraY: 0,
    initialized: false,
    recentPrices: [],
    currentSpeed: CONFIG.GRID_SPEED_ACTIVE,
    lastPrice: null,
  });

  // Check for mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (price !== null) {
      priceRef.current = price;
      setDisplayPrice(price);
    }
  }, [price]);
  
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { betAmountRef.current = betAmount; }, [betAmount]);

  // Get responsive config values
  const getCellSize = () => isMobile ? CONFIG.CELL_SIZE_MOBILE : CONFIG.CELL_SIZE;
  const getHeadX = () => isMobile ? CONFIG.HEAD_X_MOBILE : CONFIG.HEAD_X;
  const getPriceAxisWidth = () => isMobile ? CONFIG.PRICE_AXIS_WIDTH_MOBILE : CONFIG.PRICE_AXIS_WIDTH;
  const getBetOptions = () => isMobile ? CONFIG.BET_AMOUNT_OPTIONS_MOBILE : CONFIG.BET_AMOUNT_OPTIONS;

  const generateColumn = useCallback((xPosition: number, currentPriceY: number) => {
    const state = stateRef.current;
    const cellSize = getCellSize();
    const currentPriceIndex = Math.floor((currentPriceY + cellSize / 2) / cellSize);
    
    const cells: Record<number, { id: string; multiplier: string }> = {};
    for (let i = -CONFIG.VERTICAL_CELLS; i <= CONFIG.VERTICAL_CELLS; i++) {
      const yIndex = currentPriceIndex + i;
      cells[yIndex] = {
        id: Math.random().toString(36).substr(2, 9),
        multiplier: calculateMultiplier(yIndex, currentPriceIndex),
      };
    }

    state.columns.push({
      id: Math.random().toString(36).substr(2, 9),
      x: xPosition,
      cells,
      centerIndex: currentPriceIndex,
    });
    
    if (state.columns.length > 100) {
      state.columns.shift();
    }
    
    state.lastGenX = xPosition;
  }, [isMobile]);

  const playSound = useCallback((type: 'win' | 'click' | 'lose') => {
    try {
      const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'win') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === 'click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === 'lose') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
      }
    } catch {
      // Audio not supported
    }
  }, []);

  const resetGame = useCallback(() => {
    setBalance(CONFIG.INITIAL_BALANCE);
    balanceRef.current = CONFIG.INITIAL_BALANCE;
    setTotalWon(0);
    setTotalLost(0);
    basePriceRef.current = priceRef.current;
    const state = stateRef.current;
    const cellSize = getCellSize();
    state.bets = [];
    state.priceY = cellSize / 2;
    state.targetPriceY = cellSize / 2;
    state.priceHistory = [{ x: state.offsetX + getHeadX(), y: cellSize / 2 }];
    state.recentPrices = [];
    state.lastPrice = null;
  }, [isMobile]);

  const placeBetAt = useCallback((screenX: number, screenY: number, allowDuplicate = false) => {
    const currentBalance = balanceRef.current;
    const currentBetAmount = betAmountRef.current;
    const cellSize = getCellSize();
    const headX = getHeadX();
    const priceAxisWidth = getPriceAxisWidth();
    
    if (currentBalance < currentBetAmount) return false;
    if (screenX > window.innerWidth - priceAxisWidth) return false;
    
    const state = stateRef.current;
    const worldX = screenX + state.offsetX;
    const worldY = screenY - state.cameraY;
    
    const clickedCol = state.columns.find(c => worldX >= c.x && worldX < c.x + cellSize);
    
    if (clickedCol) {
      const yIndex = Math.floor(worldY / cellSize);
      const minBetX = state.offsetX + headX + cellSize * CONFIG.MIN_BET_COLUMNS_AHEAD;
      
      if (clickedCol.x > minBetX) {
        const cellKey = `${clickedCol.id}-${yIndex}`;
        if (!allowDuplicate && lastBetCellRef.current === cellKey) {
          return false;
        }
        
        const existingBet = state.bets.find(
          b => b.colId === clickedCol.id && b.yIndex === yIndex && b.status === 'pending'
        );
        if (existingBet) return false;
        
        lastBetCellRef.current = cellKey;
        playSound('click');
        
        let cell = clickedCol.cells[yIndex];
        if (!cell) {
          cell = {
            id: Math.random().toString(36).substr(2, 9),
            multiplier: calculateMultiplier(yIndex, clickedCol.centerIndex),
          };
          clickedCol.cells[yIndex] = cell;
        }

        const newBet: Bet = {
          id: Math.random().toString(36).substr(2, 9),
          colId: clickedCol.id,
          yIndex,
          amount: currentBetAmount,
          multiplier: parseFloat(cell.multiplier),
          status: 'pending',
        };
        
        state.bets.push(newBet);
        const newBalance = currentBalance - currentBetAmount;
        setBalance(newBalance);
        balanceRef.current = newBalance;
        forceUpdate(n => n + 1);
        return true;
      }
    }
    return false;
  }, [playSound, isMobile]);

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cellSize = getCellSize();
    const headX = getHeadX();
    const priceAxisWidth = getPriceAxisWidth();

    const checkBets = (currentHeadX: number, headY: number) => {
      const state = stateRef.current;
      
      state.bets.forEach(bet => {
        if (bet.status !== 'pending') return;

        const col = state.columns.find(c => c.id === bet.colId);
        if (!col) {
          bet.status = 'lost';
          setTotalLost(prev => prev + bet.amount);
          playSound('lose');
          return;
        }

        const betStartX = col.x;
        const betEndX = col.x + cellSize;
        
        if (currentHeadX >= betStartX && currentHeadX <= betEndX) {
          const cellTop = bet.yIndex * cellSize;
          const cellBottom = cellTop + cellSize;
          
          if (headY >= cellTop && headY < cellBottom) {
            bet.status = 'won';
            const winAmount = bet.amount * bet.multiplier;
            setBalance(prev => prev + winAmount);
            balanceRef.current += winAmount;
            setTotalWon(prev => prev + winAmount - bet.amount);
            setLastWin({ amount: winAmount, id: bet.id });
            playSound('win');
            setTimeout(() => setLastWin(null), 2500);
          }
        } else if (currentHeadX > betEndX) {
          bet.status = 'lost';
          setTotalLost(prev => prev + bet.amount);
          playSound('lose');
        }
      });
    };

    const calculateVolatility = (currentPrice: number): number => {
      const state = stateRef.current;
      
      state.recentPrices.push(currentPrice);
      if (state.recentPrices.length > CONFIG.FLATLINE_WINDOW) {
        state.recentPrices.shift();
      }
      
      if (state.recentPrices.length < 10) {
        return CONFIG.GRID_SPEED_ACTIVE;
      }
      
      const minPrice = Math.min(...state.recentPrices);
      const maxPrice = Math.max(...state.recentPrices);
      const priceRange = maxPrice - minPrice;
      
      if (priceRange < CONFIG.FLATLINE_THRESHOLD * 0.5) {
        setVolatilityLevel('idle');
        return CONFIG.GRID_SPEED_IDLE;
      } else if (priceRange < CONFIG.FLATLINE_THRESHOLD) {
        setVolatilityLevel('low');
        return CONFIG.GRID_SPEED_IDLE * 3;
      } else {
        setVolatilityLevel('active');
        const volatilityMultiplier = Math.min(priceRange / 0.01, 1);
        return CONFIG.GRID_SPEED_IDLE + (CONFIG.GRID_SPEED_ACTIVE - CONFIG.GRID_SPEED_IDLE) * volatilityMultiplier;
      }
    };

    const updatePhysics = () => {
      const currentPrice = priceRef.current;
      if (currentPrice === null) return;
      
      const state = stateRef.current;
      const width = canvas.width;
      const height = canvas.height;

      if (basePriceRef.current === null) {
        basePriceRef.current = currentPrice;
        state.lastPrice = currentPrice;
        state.priceY = cellSize / 2;
        state.targetPriceY = cellSize / 2;
      }

      const targetSpeed = calculateVolatility(currentPrice);
      state.currentSpeed += (targetSpeed - state.currentSpeed) * 0.02;
      state.offsetX += state.currentSpeed;

      const rightEdge = state.offsetX + width;
      if (state.lastGenX < rightEdge + cellSize * 2) {
        generateColumn(state.lastGenX + cellSize, state.priceY);
      }

      const priceDelta = currentPrice - basePriceRef.current;
      state.targetPriceY = -priceDelta * CONFIG.PRICE_SCALE + cellSize / 2;
      
      const diff = state.targetPriceY - state.priceY;
      state.priceY += diff * CONFIG.PRICE_SMOOTHING;
      
      const currentWorldX = state.offsetX + headX;
      
      const lastPoint = state.priceHistory[state.priceHistory.length - 1];
      if (!lastPoint || currentWorldX - lastPoint.x > 0.5) {
        state.priceHistory.push({ x: currentWorldX, y: state.priceY });
      }
      
      if (state.priceHistory.length > 5000) {
        state.priceHistory.shift();
      }

      const targetCameraY = -state.priceY + height / 2;
      state.cameraY += (targetCameraY - state.cameraY) * 0.02;

      state.lastPrice = currentPrice;
      checkBets(currentWorldX, state.priceY);
    };

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const width = canvas.width;
      const height = canvas.height;
      const state = stateRef.current;
      const currentPrice = priceRef.current ?? basePriceRef.current ?? 0;

      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#12001f');
      gradient.addColorStop(0.5, CONFIG.BG_COLOR);
      gradient.addColorStop(1, '#08000f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(0, state.cameraY);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${isMobile ? 8 : 10}px "JetBrains Mono", "SF Mono", monospace`;
      
      const startColIndex = state.columns.findIndex(c => c.x + cellSize > state.offsetX);
      const currentHeadX = state.offsetX + headX;
      
      for (let i = Math.max(0, startColIndex); i < state.columns.length; i++) {
        const col = state.columns[i];
        const screenX = col.x - state.offsetX;
        
        if (screenX > width - priceAxisWidth) break;

        ctx.strokeStyle = CONFIG.GRID_LINE_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(screenX, -8000);
        ctx.lineTo(screenX, 8000);
        ctx.stroke();

        const startY = -state.cameraY - cellSize * 3;
        const endY = -state.cameraY + height + cellSize * 3;
        const isBettable = col.x > currentHeadX + cellSize * CONFIG.MIN_BET_COLUMNS_AHEAD;

        Object.entries(col.cells).forEach(([yIdx, cell]) => {
          const y = parseInt(yIdx) * cellSize;
          if (y < startY || y > endY) return;

          ctx.strokeStyle = CONFIG.GRID_LINE_COLOR;
          ctx.beginPath();
          ctx.moveTo(screenX, y);
          ctx.lineTo(screenX + cellSize, y);
          ctx.stroke();

          ctx.fillStyle = CONFIG.GRID_DOT_COLOR;
          ctx.beginPath();
          ctx.arc(screenX, y, 1.5, 0, Math.PI * 2);
          ctx.fill();

          const mult = parseFloat(cell.multiplier);
          const intensity = Math.min((mult - 1) / 5, 1);
          const alpha = isBettable ? (0.15 + intensity * 0.35) : 0.08;
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
          ctx.fillText(`${cell.multiplier}X`, screenX + cellSize / 2, y + cellSize / 2);
        });
      }

      state.bets.forEach(bet => {
        const col = state.columns.find(c => c.id === bet.colId);
        if (!col) return;

        const screenX = col.x - state.offsetX;
        const y = bet.yIndex * cellSize;
        
        if (screenX < -cellSize || screenX > width) return;

        let fill = '#c8e64c';
        let textColor = '#000';
        
        if (bet.status === 'won') {
          fill = '#4ade80';
        } else if (bet.status === 'lost') {
          fill = 'rgba(239, 68, 68, 0.3)';
          textColor = '#ef4444';
        }

        ctx.fillStyle = fill;
        ctx.fillRect(screenX + 3, y + 3, cellSize - 6, cellSize - 6);
        
        ctx.strokeStyle = bet.status === 'lost' ? '#ef4444' : '#e0f060';
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX + 3, y + 3, cellSize - 6, cellSize - 6);

        ctx.fillStyle = textColor;
        ctx.font = `bold ${isMobile ? 9 : 11}px sans-serif`;
        ctx.fillText(`$${bet.amount}`, screenX + cellSize / 2, y + cellSize / 2 - (isMobile ? 4 : 6));
        
        ctx.font = `${isMobile ? 7 : 9}px sans-serif`;
        ctx.fillStyle = bet.status === 'lost' ? '#ef4444' : 'rgba(0,0,0,0.7)';
        ctx.fillText(`${bet.multiplier.toFixed(2)}X`, screenX + cellSize / 2, y + cellSize / 2 + (isMobile ? 6 : 8));
      });

      if (state.priceHistory.length > 1) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = CONFIG.PRICE_LINE_GLOW;
        ctx.strokeStyle = CONFIG.PRICE_LINE_COLOR;
        ctx.lineWidth = isMobile ? 2 : 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        const firstPoint = state.priceHistory[0];
        ctx.moveTo(firstPoint.x - state.offsetX, firstPoint.y);
        
        for (let i = 1; i < state.priceHistory.length; i++) {
          const p = state.priceHistory[i];
          ctx.lineTo(p.x - state.offsetX, p.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(headX, state.priceY, isMobile ? 5 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = CONFIG.PRICE_LINE_COLOR;
        ctx.beginPath();
        ctx.arc(headX, state.priceY, isMobile ? 2 : 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Price axis - always render with solid background
      ctx.fillStyle = '#0a0014';
      ctx.fillRect(width - priceAxisWidth, 0, priceAxisWidth, height);
      
      // Axis border
      ctx.strokeStyle = 'rgba(255, 100, 150, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width - priceAxisWidth, 0);
      ctx.lineTo(width - priceAxisWidth, height);
      ctx.stroke();

      // Get display price - use multiple fallbacks
      const displayPriceValue = priceRef.current ?? currentPrice ?? 100;
      const centerScreenY = height / 2;
      
      ctx.font = `${isMobile ? 9 : 11}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      
      // Always render price labels
      const priceStep = isMobile ? 0.05 : 0.02;
      const labelStep = isMobile ? 2 : 5; // Show label every N steps
      
      for (let i = -40; i <= 40; i++) {
        const pixelOffset = i * (priceStep * CONFIG.PRICE_SCALE);
        const screenY = centerScreenY + pixelOffset;
        
        if (screenY < 0 || screenY > height) continue;
        
        const priceAtLevel = displayPriceValue - (i * priceStep);
        
        // Tick marks - always draw
        ctx.strokeStyle = 'rgba(255, 100, 150, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(width - priceAxisWidth, screenY);
        ctx.lineTo(width - priceAxisWidth + 5, screenY);
        ctx.stroke();
        
        // Price labels at intervals
        if (i % labelStep === 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.fillText(`$${priceAtLevel.toFixed(2)}`, width - 6, screenY);
        }
      }
      
      // Current price highlight bar - always show
      ctx.fillStyle = CONFIG.PRICE_LINE_COLOR;
      ctx.fillRect(width - priceAxisWidth, centerScreenY - 12, priceAxisWidth, 24);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${isMobile ? 10 : 12}px "JetBrains Mono", monospace`;
      ctx.fillText(`$${displayPriceValue.toFixed(2)}`, width - 6, centerScreenY);
      
      // Speed bar
      const speedRatio = state.currentSpeed / CONFIG.GRID_SPEED_ACTIVE;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, height - 4, width - priceAxisWidth, 4);
      
      const speedColor = speedRatio > 0.5 ? '#4ade80' : speedRatio > 0.2 ? '#fbbf24' : '#ef4444';
      ctx.fillStyle = speedColor;
      ctx.fillRect(0, height - 4, (width - priceAxisWidth) * speedRatio, 4);
    };

    const animate = () => {
      updatePhysics();
      render();
      requestRef.current = requestAnimationFrame(animate);
    };

    if (!stateRef.current.initialized) {
      const state = stateRef.current;
      state.offsetX = 0;
      state.priceY = cellSize / 2;
      state.targetPriceY = cellSize / 2;
      state.priceHistory = [{ x: headX, y: cellSize / 2 }];
      state.columns = [];
      state.bets = [];
      state.lastGenX = 0;
      state.cameraY = window.innerHeight / 2;
      state.initialized = true;
      state.recentPrices = [];
      state.currentSpeed = CONFIG.GRID_SPEED_ACTIVE;
      state.lastPrice = null;
      
      for (let x = 0; x < window.innerWidth + 600; x += cellSize) {
        generateColumn(x, cellSize / 2);
      }
    }

    requestRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [generateColumn, playSound, isMobile]);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (showRoadmap || showPriceDropdown) return;
    setIsDragging(true);
    lastBetCellRef.current = null;
    const rect = canvasRef.current!.getBoundingClientRect();
    placeBetAt(e.clientX - rect.left, e.clientY - rect.top, true);
  }, [placeBetAt, showRoadmap, showPriceDropdown]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging || showRoadmap || showPriceDropdown) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    placeBetAt(e.clientX - rect.left, e.clientY - rect.top, false);
  }, [isDragging, placeBetAt, showRoadmap, showPriceDropdown]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    lastBetCellRef.current = null;
  }, []);

  const handlePointerLeave = useCallback(() => {
    setIsDragging(false);
    lastBetCellRef.current = null;
  }, []);

  return (
    <div className="relative w-full h-screen overflow-hidden font-sans select-none">
      <canvas 
        ref={canvasRef}
        className={`block ${isDragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />

      {/* Price Indicator with Dropdown */}
      <div className="absolute top-2 sm:top-4 left-2 sm:left-4 pointer-events-none">
        <button
          onClick={() => setShowPriceDropdown(!showPriceDropdown)}
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
          onClose={() => setShowPriceDropdown(false)}
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

      {/* Top Right Controls - responsive */}
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
        
        {/* Roadmap Button */}
        <button 
          onClick={() => setShowRoadmap(true)}
          className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 rounded-lg sm:rounded-xl text-white text-xs sm:text-sm font-semibold shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all"
        >
          <Map size={isMobile ? 14 : 18} />
          <span className="hidden sm:inline">Roadmap</span>
          <span className="hidden lg:inline px-1.5 py-0.5 bg-white/20 rounded text-[10px] font-bold uppercase">New</span>
        </button>
        
        {/* Reset Button */}
        <button 
          onClick={resetGame}
          className="p-1.5 sm:p-2 bg-white/5 hover:bg-white/10 rounded-lg sm:rounded-xl text-white/60 hover:text-white border border-white/10 transition-all"
          title="Reset Game"
        >
          <RefreshCw size={isMobile ? 14 : 18} />
        </button>
      </div>
        
      {/* Win notification - responsive */}
      {lastWin && (
        <div className="absolute top-16 sm:top-24 left-2 sm:left-4 animate-bounce bg-gradient-to-r from-green-500 to-emerald-400 text-white font-bold py-1.5 sm:py-2 px-3 sm:px-4 rounded-lg sm:rounded-xl shadow-2xl shadow-green-500/30 flex items-center gap-1.5 sm:gap-2 pointer-events-none">
          <Plus size={isMobile ? 12 : 16} />
          <span className="font-mono text-sm sm:text-base">+{lastWin.amount.toFixed(0)} 💎</span>
        </div>
      )}

      {/* Bet Controls - responsive */}
      <div className="absolute bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 w-[95%] sm:w-auto">
        <div className="bg-black/70 backdrop-blur-xl border border-white/10 rounded-xl sm:rounded-2xl p-3 sm:p-4 flex items-center justify-center gap-2 sm:gap-4">
          <button 
            onClick={() => setBetAmount(prev => Math.max(1, prev - 5))}
            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all border border-white/10"
          >
            <Minus size={isMobile ? 12 : 14} />
          </button>
          
          <div className="text-lg sm:text-xl font-bold text-white min-w-[3ch] sm:min-w-[4ch] text-center font-mono">
            ${betAmount}
          </div>
          
          <button 
            onClick={() => setBetAmount(prev => prev + 5)}
            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all border border-white/10"
          >
            <Plus size={isMobile ? 12 : 14} />
          </button>
          
          <div className="w-px h-5 sm:h-6 bg-white/10" />
          
          <div className="flex gap-1">
            {getBetOptions().map(amt => (
              <button
                key={amt}
                onClick={() => setBetAmount(amt)}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${
                  betAmount === amt 
                    ? 'bg-[#c8e64c] text-black' 
                    : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'
                }`}
              >
                ${amt}
              </button>
            ))}
          </div>
        </div>
        
        <div className="text-center mt-1.5 sm:mt-2 text-white/30 text-[10px] sm:text-xs">
          Tap or drag to bet
        </div>
      </div>

      {/* Social Links - responsive positioning */}
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

      {/* Roadmap Modal */}
      <RoadmapModal isOpen={showRoadmap} onClose={() => setShowRoadmap(false)} />
      
      {/* Splash Screen Overlay */}
      {showSplash && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer"
          onClick={() => setShowSplash(false)}
        >
          {/* Blurry backdrop showing game behind */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
          
          {/* Content */}
          <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-md">
            {/* Logo/Title */}
            <div className="mb-6">
              <h1 className="text-5xl sm:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-purple-400 mb-2">
                EUPHORIA
              </h1>
              <p className="text-white/60 text-sm sm:text-base font-medium">
                Real-time Solana Price Prediction
              </p>
            </div>
            
            {/* Info Cards */}
            <div className="w-full space-y-3 mb-8">
              <div className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl">
                <span className="text-white/50 text-sm">CA</span>
                <span className="text-purple-400 font-mono text-sm font-bold">Coming Soon</span>
              </div>
              
              <div className="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl">
                <span className="text-white/50 text-sm">Dev</span>
                <a 
                  href="https://x.com/oSKNYo_dev" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-pink-400 font-mono text-sm font-bold hover:text-pink-300 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  @oSKNYo_dev
                </a>
              </div>
              
              <a 
                href="https://github.com/Tanner253/Euphoria" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Github size={18} className="text-white/70" />
                <span className="text-white/70 text-sm font-medium">View on GitHub</span>
              </a>
            </div>
            
            {/* CTA */}
            <div className="flex flex-col items-center gap-3">
              <div className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl shadow-lg shadow-purple-500/30">
                <span className="text-white font-bold text-lg">
                  {isMobile ? 'TAP TO BEGIN' : 'CLICK TO BEGIN'}
                </span>
              </div>
              <p className="text-white/30 text-xs">
                Demo mode • 1,000 free gems to play
              </p>
            </div>
            
            {/* Animated hint */}
            <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 animate-bounce">
              <ChevronDown size={32} className="text-white/20" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
