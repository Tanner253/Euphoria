'use client';

/**
 * SplashScreen - Initial landing overlay with wallet connection and demo mode options
 */

import { ChevronDown, Github, Shield, Wallet } from 'lucide-react';

interface SplashScreenProps {
  onConnectWallet: () => void;
  onSkipToDemo: () => void;
}

export default function SplashScreen({ onConnectWallet, onSkipToDemo }: SplashScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
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
            >
              @oSKNYo_dev
            </a>
          </div>
          
          <a 
            href="https://github.com/Tanner253/Euphoria" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
          >
            <Github size={18} className="text-white/70" />
            <span className="text-white/70 text-sm font-medium">View on GitHub</span>
          </a>
        </div>
        
        {/* x403 Safety Banner */}
        <div className="w-full p-3 mb-4 bg-green-500/10 border border-green-500/30 rounded-xl">
          <div className="flex items-center gap-2 text-green-400 text-xs">
            <Shield size={14} />
            <span><strong>x403 Auth:</strong> Read-only signature • No funds transferred</span>
          </div>
        </div>
        
        {/* CTA Buttons */}
        <div className="w-full flex flex-col items-center gap-3">
          {/* Connect Wallet Button - Primary */}
          <button
            onClick={onConnectWallet}
            className="w-full px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 
                       rounded-2xl shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 
                       transition-all active:scale-[0.98] group"
          >
            <div className="flex items-center justify-center gap-3">
              <Wallet className="w-5 h-5 text-white" />
              <span className="text-white font-bold text-lg">Connect Phantom Wallet</span>
            </div>
            <p className="text-white/60 text-xs mt-1">Sign in with x403 authentication</p>
          </button>
          
          {/* Skip to Demo Button - Secondary */}
          <button
            onClick={onSkipToDemo}
            className="w-full px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/20 hover:border-white/30
                       rounded-xl transition-all text-white/70 hover:text-white"
          >
            <span className="font-medium">Skip for Demo</span>
            <p className="text-white/40 text-xs mt-0.5">1,000 free gems • No wallet required</p>
          </button>
        </div>
        
        {/* Animated hint */}
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown size={32} className="text-white/20" />
        </div>
      </div>
    </div>
  );
}

