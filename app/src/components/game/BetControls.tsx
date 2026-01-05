'use client';

/**
 * BetControls - Bet amount selection and quick bet buttons
 */

import { useState, useEffect } from 'react';
import { Plus, Minus } from 'lucide-react';

interface BetControlsProps {
  betAmount: number;
  onBetAmountChange: (amount: number) => void;
  betOptions: number[];
  isMobile: boolean;
  sidebarWidth?: number;
}

export default function BetControls({ 
  betAmount, 
  onBetAmountChange, 
  betOptions, 
  isMobile,
  sidebarWidth = 0
}: BetControlsProps) {
  const MAX_BET = 100;
  
  // Must declare hooks before any conditional returns
  const [inputValue, setInputValue] = useState(betAmount.toString());
  
  // Sync input with bet amount changes from buttons
  useEffect(() => {
    setInputValue(betAmount.toString());
  }, [betAmount]);
  
  if (isMobile) {
    // Mobile: Compact horizontal bar at bottom with animations
    return (
      <div className="fixed bottom-3 left-2 right-2 z-30 slide-in-up">
        <div className="bg-black/80 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-3 flex items-center justify-between gap-3 animate-pulse-border">
          {/* Decrease */}
          <button 
            onClick={() => onBetAmountChange(Math.max(1, betAmount - 1))}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 active:bg-white/20 active:scale-95 text-white border border-white/20 transition-all"
          >
            <Minus size={18} />
          </button>
          
          {/* Current bet */}
          <div className="text-2xl font-bold text-white text-center font-mono flex-1 flex items-center justify-center gap-1">
            <span className="animate-glow-text text-cyan-300">{betAmount}</span> 
            <span className="text-purple-400 animate-bounce-subtle">💎</span>
          </div>
          
          {/* Increase */}
          <button 
            onClick={() => onBetAmountChange(Math.min(MAX_BET, betAmount + 1))}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 active:bg-white/20 active:scale-95 text-white border border-white/20 transition-all"
          >
            <Plus size={18} />
          </button>
          
          {/* Divider */}
          <div className="w-px h-8 bg-cyan-500/30" />
          
          {/* Quick options */}
          <div className="flex gap-1.5">
            {betOptions.map(amt => (
              <button
                key={amt}
                onClick={() => onBetAmountChange(amt)}
                className={`w-10 h-10 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                  betAmount === amt 
                    ? 'bg-[#c8e64c] text-black shadow-lg shadow-[#c8e64c]/30' 
                    : 'bg-white/10 text-white/60 active:bg-white/20 hover:border-cyan-500/50 border border-transparent'
                }`}
              >
                {amt}
              </button>
            ))}
          </div>
        </div>
        
        {/* Helper text with glow */}
        <div className="text-center mt-2 text-cyan-400/60 text-xs animate-pulse">
          Tap glowing cells to bet
        </div>
      </div>
    );
  }
  
  // Desktop layout
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    setInputValue(value);
    const num = parseInt(value) || 1;
    if (num >= 1 && num <= MAX_BET) {
      onBetAmountChange(num);
    }
  };
  
  const handleInputBlur = () => {
    const num = parseInt(inputValue) || 1;
    const clamped = Math.min(MAX_BET, Math.max(1, num));
    setInputValue(clamped.toString());
    onBetAmountChange(clamped);
  };
  
  return (
    <div 
      className="fixed bottom-8 z-30 slide-in-up -translate-x-1/2"
      style={{ left: `calc(50% + ${sidebarWidth / 2}px)` }}
    >
      <div className="bg-black/70 backdrop-blur-xl border border-cyan-500/20 rounded-2xl p-4 flex items-center justify-center gap-3 hover:border-cyan-500/40 transition-all">
        {/* Half button */}
        <button 
          onClick={() => onBetAmountChange(Math.max(1, Math.floor(betAmount / 2)))}
          className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-cyan-500/20 text-white/60 hover:text-cyan-300 transition-all border border-white/10 hover:border-cyan-500/30 text-xs font-bold active:scale-95"
        >
          ½
        </button>
        
        {/* Decrease button */}
        <button 
          onClick={() => onBetAmountChange(Math.max(1, betAmount - 10))}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-cyan-500/20 text-white/60 hover:text-cyan-300 transition-all border border-white/10 hover:border-cyan-500/30 active:scale-95"
        >
          <Minus size={14} />
        </button>
        
        {/* Editable bet input with gem icon */}
        <div className="relative flex items-center gap-1">
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleInputBlur()}
            className="w-20 bg-white/5 border border-cyan-500/30 rounded-lg py-2 px-3 text-xl font-bold text-cyan-300 text-center font-mono focus:outline-none focus:border-cyan-400 focus:shadow-lg focus:shadow-cyan-500/20 transition-all"
          />
          <span className="text-xl animate-bounce-subtle">💎</span>
        </div>
        
        {/* Increase button */}
        <button 
          onClick={() => onBetAmountChange(Math.min(MAX_BET, betAmount + 10))}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-cyan-500/20 text-white/60 hover:text-cyan-300 transition-all border border-white/10 hover:border-cyan-500/30 active:scale-95"
        >
          <Plus size={14} />
        </button>
        
        {/* Double button */}
        <button 
          onClick={() => onBetAmountChange(Math.min(MAX_BET, betAmount * 2))}
          className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-cyan-500/20 text-white/60 hover:text-cyan-300 transition-all border border-white/10 hover:border-cyan-500/30 text-xs font-bold active:scale-95"
        >
          2×
        </button>
        
        {/* Divider */}
        <div className="w-px h-8 bg-cyan-500/30" />
        
        {/* Quick bet options */}
        <div className="flex gap-1.5">
          {betOptions.map(amt => (
            <button
              key={amt}
              onClick={() => onBetAmountChange(amt)}
              className={`px-3 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-1 active:scale-95 ${
                betAmount === amt 
                  ? 'bg-[#c8e64c] text-black shadow-lg shadow-[#c8e64c]/30 animate-pulse-glow' 
                  : 'bg-white/5 text-white/50 hover:bg-cyan-500/20 hover:text-cyan-300 hover:border-cyan-500/30 border border-transparent'
              }`}
            >
              {amt}
            </button>
          ))}
        </div>
      </div>
      
      {/* Helper text with animation */}
      <div className="text-center mt-2 text-cyan-400/50 text-xs">
        Click <span className="text-cyan-400 animate-pulse">glowing cells</span> to place bets • Drag to place multiple • Max 100💎
      </div>
    </div>
  );
}

