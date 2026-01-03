'use client';

/**
 * RoadmapModal - Displays the Euphoria roadmap with phases and features
 */

import { useState } from 'react';
import { Map, X, Rocket, Coins, Zap, Globe, Check, Circle, Github, Shield, Wallet, Server, ArrowDownToLine, ArrowUpFromLine, Clock } from 'lucide-react';

interface RoadmapPhase {
  id: number;
  title: string;
  status: 'completed' | 'current' | 'upcoming' | 'planned' | 'future';
  icon: typeof Rocket;
  color: string;
  items: Array<{ text: string; done: boolean }>;
}

const ROADMAP_PHASES: RoadmapPhase[] = [
  {
    id: 0,
    title: "Phase 1: Foundation",
    status: "completed",
    icon: Rocket,
    color: "from-green-500 to-emerald-400",
    items: [
      { text: "Real-time SOL/USD price feed (Binance/Coinbase)", done: true },
      { text: "Demo mode with 1,000 free gems", done: true },
      { text: "Smooth price-action betting grid", done: true },
      { text: "Dynamic volatility-based scroll speed", done: true },
      { text: "Click & drag bet placement", done: true },
      { text: "Win/loss sound effects & visual feedback", done: true },
    ]
  },
  {
    id: 1,
    title: "Phase 2: Web3 & Security",
    status: "completed",
    icon: Wallet,
    color: "from-purple-500 to-pink-500",
    items: [
      { text: "Phantom Wallet integration", done: true },
      { text: "x403 no-KYC authentication", done: true },
      { text: "Seamless Phantom deposit flow (1-click buy)", done: true },
      { text: "On-chain transaction verification", done: true },
      { text: "Server-authoritative bet resolution", done: true },
      { text: "Secure session management (JWT)", done: true },
    ]
  },
  {
    id: 2,
    title: "Phase 3: Economy",
    status: "completed",
    icon: Coins,
    color: "from-yellow-500 to-orange-500",
    items: [
      { text: "Gems → SOL withdrawal (2% platform fee)", done: true },
      { text: "Withdrawal queue system for fund availability", done: true },
      { text: "Transaction history & audit log", done: true },
      { text: "Admin dashboard for monitoring", done: true },
      { text: "Anti-fraud: deposit-only withdrawal limit", done: true },
      { text: "Rate limiting: 1 withdrawal per minute", done: true },
    ]
  },
  {
    id: 3,
    title: "Phase 4: Social & Compete",
    status: "upcoming",
    icon: Globe,
    color: "from-blue-500 to-cyan-400",
    items: [
      { text: "Global leaderboards", done: false },
      { text: "Live player activity feed", done: false },
      { text: "Tournaments & competitions", done: false },
      { text: "Achievement badges", done: false },
      { text: "Social sharing integration", done: false },
      { text: "Referral rewards program", done: false },
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
      { text: "Mobile native apps (iOS/Android)", done: false },
      { text: "API for third-party integration", done: false },
      { text: "Advanced analytics dashboard", done: false },
    ]
  },
];

interface RoadmapModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function RoadmapModal({ isOpen, onClose }: RoadmapModalProps) {
  const [activePhase, setActivePhase] = useState(1); // Start on current phase

  if (!isOpen) return null;

  const phases = ROADMAP_PHASES;

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
          
          {/* Phase tabs */}
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
                {phase.status === 'completed' && <Check size={12} className="text-green-300" />}
              </button>
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto max-h-[50vh] sm:max-h-[60vh]">
          {/* Server Authoritative Banner */}
          <ServerAuthoritativeBanner />
          
          {phases.map((phase, i) => (
            <PhaseContent 
              key={phase.id} 
              phase={phase} 
              isActive={activePhase === i} 
            />
          ))}
        </div>
        
        {/* Footer */}
        <RoadmapFooter />
      </div>
    </div>
  );
}

function ServerAuthoritativeBanner() {
  return (
    <div className="mb-4 sm:mb-6 p-4 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-xl sm:rounded-2xl">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-green-500/20 rounded-lg flex-shrink-0">
          <Server size={20} className="text-green-400" />
        </div>
        <div>
          <h4 className="font-bold text-white text-sm sm:text-base mb-1 flex items-center gap-2">
            ✓ 100% Server-Authoritative
            <span className="px-2 py-0.5 bg-green-500/30 text-green-300 text-[10px] font-bold rounded-full uppercase">Secure</span>
          </h4>
          <p className="text-white/70 text-xs sm:text-sm mb-2">
            All bets are placed and resolved on the server. Client cannot manipulate outcomes, balances, or game state.
            Your real balance is always stored in our secure database.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="px-2 py-1 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-[10px] font-medium">
              1-click Phantom deposits
            </span>
            <span className="px-2 py-1 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-[10px] font-medium">
              Sell gems → SOL
            </span>
            <span className="px-2 py-1 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-[10px] font-medium">
              Withdrawal queue
            </span>
            <span className="px-2 py-1 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-[10px] font-medium">
              2% fee
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhaseContent({ phase, isActive }: { phase: RoadmapPhase; isActive: boolean }) {
  const completedCount = phase.items.filter(item => item.done).length;
  const progress = (completedCount / phase.items.length) * 100;
  
  return (
    <div className={`transition-all duration-300 ${isActive ? 'block' : 'hidden'}`}>
      <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className={`p-2.5 sm:p-4 bg-gradient-to-br ${phase.color} rounded-xl sm:rounded-2xl shadow-lg`}>
          <phase.icon size={24} className="text-white sm:w-8 sm:h-8" />
        </div>
        <div className="flex-1">
          <h3 className="text-base sm:text-xl font-bold text-white">{phase.title}</h3>
          <div className="flex items-center gap-3 mt-1">
            <StatusBadge status={phase.status} />
            <div className="flex-1 max-w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div 
                className={`h-full bg-gradient-to-r ${phase.color} rounded-full transition-all`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-white/40 text-xs">{completedCount}/{phase.items.length}</span>
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
      
      {/* Phase-specific extra content */}
      {phase.id === 1 && <Phase2InfoCards />}
      {phase.id === 2 && <Phase3InfoCard />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    completed: 'bg-green-500/20 text-green-400',
    current: 'bg-purple-500/20 text-purple-400',
    upcoming: 'bg-yellow-500/20 text-yellow-400',
    planned: 'bg-blue-500/20 text-blue-400',
    future: 'bg-white/10 text-white/50',
  };
  
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold uppercase ${
      styles[status as keyof typeof styles]
    }`}>
      {(status === 'current' || status === 'completed') && (
        <span className={`w-1.5 h-1.5 rounded-full ${status === 'completed' ? 'bg-green-400' : 'bg-purple-400 animate-pulse'}`} />
      )}
      {status}
    </div>
  );
}

function Phase2InfoCards() {
  return (
    <div className="mt-4 sm:mt-6 space-y-3">
      <div className="p-3 sm:p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg sm:rounded-xl">
        <div className="flex items-start gap-2 sm:gap-3">
          <Shield size={18} className="text-purple-400 flex-shrink-0 mt-0.5 sm:w-5 sm:h-5" />
          <div>
            <h4 className="font-bold text-white text-sm sm:text-base mb-1">x403 No-KYC Authentication</h4>
            <p className="text-white/60 text-xs sm:text-sm">
              Privacy-preserving wallet authentication. Sign a message with your Phantom wallet to prove ownership. 
              No email, no KYC, no personal data collected. Your keys, your coins, your privacy.
            </p>
          </div>
        </div>
      </div>
      
      <div className="p-3 sm:p-4 bg-green-500/10 border border-green-500/20 rounded-lg sm:rounded-xl">
        <div className="flex items-start gap-2 sm:gap-3">
          <ArrowDownToLine size={18} className="text-green-400 flex-shrink-0 mt-0.5 sm:w-5 sm:h-5" />
          <div>
            <h4 className="font-bold text-white text-sm sm:text-base mb-1">Seamless Phantom Deposits</h4>
            <p className="text-white/60 text-xs sm:text-sm">
              Click a buy amount → Phantom popup opens → Approve → Gems credited instantly. 
              No copying wallet addresses or transaction hashes. One-click seamless experience.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] rounded-full">1 SOL = 1,000 Gems</span>
              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] rounded-full">No deposit fees</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Phase3InfoCard() {
  return (
    <div className="mt-4 sm:mt-6 space-y-3">
      <div className="p-3 sm:p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg sm:rounded-xl">
        <div className="flex items-start gap-2 sm:gap-3">
          <ArrowUpFromLine size={18} className="text-orange-400 flex-shrink-0 mt-0.5 sm:w-5 sm:h-5" />
          <div>
            <h4 className="font-bold text-white text-sm sm:text-base mb-1">Sell Gems for SOL</h4>
            <p className="text-white/60 text-xs sm:text-sm">
              Convert your gems back to SOL anytime. Click your balance → Sell tab → Enter amount → SOL sent to your wallet.
              Only withdraw up to what you&apos;ve deposited - winnings stay as gems for playing.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-[10px] rounded-full">2% withdrawal fee</span>
              <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-[10px] rounded-full">Min 100 gems</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg sm:rounded-xl">
        <div className="flex items-start gap-2 sm:gap-3">
          <Clock size={18} className="text-blue-400 flex-shrink-0 mt-0.5 sm:w-5 sm:h-5" />
          <div>
            <h4 className="font-bold text-white text-sm sm:text-base mb-1">Withdrawal Queue System</h4>
            <p className="text-white/60 text-xs sm:text-sm">
              If the custodial wallet can&apos;t cover your withdrawal immediately, you&apos;ll be placed in a queue.
              When funds are available, withdrawals process automatically in order. You can cancel queued withdrawals anytime for a full gems refund.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded-full">FIFO queue</span>
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded-full">Cancel anytime</span>
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded-full">Auto-process</span>
            </div>
          </div>
        </div>
      </div>
      
      <div className="p-3 sm:p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg sm:rounded-xl">
        <div className="flex items-start gap-2 sm:gap-3">
          <Coins size={18} className="text-yellow-400 flex-shrink-0 mt-0.5 sm:w-5 sm:h-5" />
          <div>
            <h4 className="font-bold text-white text-sm sm:text-base mb-1">Anti-Drain Protection</h4>
            <p className="text-white/60 text-xs sm:text-sm">
              You can only withdraw gems equivalent to what you&apos;ve deposited. 
              This ensures the custodial wallet always has enough SOL to cover legitimate withdrawals.
              Won gems can be used to keep playing!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoadmapFooter() {
  return (
    <div className="p-4 sm:p-6 border-t border-white/10 bg-black/20">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-white/40 text-xs sm:text-sm text-center sm:text-left">
          Built on Solana • Serverless Architecture • 100% Server-Authoritative
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
  );
}
