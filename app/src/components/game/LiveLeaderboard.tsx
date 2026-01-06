'use client';

/**
 * Live Leaderboard Component
 * 
 * Real-time leaderboard powered by Socket.io.
 * Updates automatically when players win/lose.
 */

import React, { useState } from 'react';
import { useLeaderboard, LeaderboardEntry, RecentWin } from '@/hooks/useLeaderboard';
import { Trophy, TrendingUp, Users, Zap, Activity, X, Crown, Flame, Medal } from 'lucide-react';

interface LiveLeaderboardProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LiveLeaderboard({ isOpen, onClose }: LiveLeaderboardProps) {
  const { 
    isConnected, 
    leaderboard, 
    recentWins, 
    liveStats,
  } = useLeaderboard({ autoSubscribe: isOpen });
  
  const [activeTab, setActiveTab] = useState<'top' | 'recent'>('top');
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className="relative w-full max-w-lg max-h-[85vh] overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(180deg, #1a0a2e 0%, #0d0015 100%)',
          border: '1px solid rgba(255, 100, 200, 0.3)',
          boxShadow: '0 0 60px rgba(255, 100, 200, 0.2), 0 0 100px rgba(100, 50, 150, 0.1)',
        }}
      >
        {/* Header */}
        <div 
          className="relative px-6 py-4 border-b border-pink-500/20"
          style={{
            background: 'linear-gradient(90deg, rgba(255, 100, 200, 0.1) 0%, rgba(100, 50, 255, 0.1) 100%)',
          }}
        >
          <button
            onClick={onClose}
            className="absolute right-4 top-4 p-1 text-white/50 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
          
          <div className="flex items-center gap-3">
            <div 
              className="p-2 rounded-xl"
              style={{ background: 'linear-gradient(135deg, #ff66aa 0%, #aa44ff 100%)' }}
            >
              <Trophy size={24} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Live Leaderboard</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-white/50">
                  {isConnected ? 'Real-time updates' : 'Auto-refresh every 10s'}
                </span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Live Stats Bar */}
        {liveStats && (
          <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-pink-500/10 bg-black/30">
            <div className="flex items-center gap-2 text-center">
              <Users size={14} className="text-cyan-400" />
              <div>
                <div className="text-lg font-bold text-white">{liveStats.onlinePlayers}</div>
                <div className="text-[10px] text-white/40">Online</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-center">
              <Zap size={14} className="text-yellow-400" />
              <div>
                <div className="text-lg font-bold text-white">{liveStats.totalBetsToday}</div>
                <div className="text-[10px] text-white/40">Bets Today</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-center">
              <Activity size={14} className="text-green-400" />
              <div>
                <div className="text-lg font-bold text-white">
                  {liveStats.totalVolumeToday >= 1000 
                    ? `${(liveStats.totalVolumeToday / 1000).toFixed(1)}K` 
                    : liveStats.totalVolumeToday}
                </div>
                <div className="text-[10px] text-white/40">Volume</div>
              </div>
            </div>
          </div>
        )}
        
        {/* Tabs */}
        <div className="flex border-b border-pink-500/10">
          <button
            onClick={() => setActiveTab('top')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'top' 
                ? 'text-pink-400 border-b-2 border-pink-400 bg-pink-400/5' 
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Crown size={16} />
              Top Players
            </div>
          </button>
          <button
            onClick={() => setActiveTab('recent')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'recent' 
                ? 'text-pink-400 border-b-2 border-pink-400 bg-pink-400/5' 
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Flame size={16} />
              Recent Wins
            </div>
          </button>
        </div>
        
        {/* Content */}
        <div className="overflow-y-auto max-h-[400px]">
          {activeTab === 'top' ? (
            <TopPlayersTab leaderboard={leaderboard} />
          ) : (
            <RecentWinsTab recentWins={recentWins} />
          )}
        </div>
        
        {/* Footer */}
        <div className="px-4 py-3 border-t border-pink-500/10 bg-black/30">
          <div className="text-center text-[10px] text-white/30">
            Updates automatically • Powered by Socket.io
          </div>
        </div>
      </div>
    </div>
  );
}

function TopPlayersTab({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  if (leaderboard.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-white/40">
        <Trophy size={48} className="mb-4 opacity-30" />
        <p className="text-sm">No players yet</p>
        <p className="text-xs mt-1">Be the first to make history!</p>
      </div>
    );
  }
  
  return (
    <div className="divide-y divide-pink-500/10">
      {leaderboard.map((entry, index) => (
        <LeaderboardRow key={entry.walletAddress} entry={entry} index={index} />
      ))}
    </div>
  );
}

function LeaderboardRow({ entry, index }: { entry: LeaderboardEntry; index: number }) {
  const getRankIcon = () => {
    switch (index) {
      case 0: return <Crown size={18} className="text-yellow-400" />;
      case 1: return <Medal size={18} className="text-gray-300" />;
      case 2: return <Medal size={18} className="text-amber-600" />;
      default: return <span className="text-white/30 text-sm font-mono">#{entry.rank}</span>;
    }
  };
  
  const getRankBg = () => {
    switch (index) {
      case 0: return 'bg-gradient-to-r from-yellow-500/10 to-transparent';
      case 1: return 'bg-gradient-to-r from-gray-400/10 to-transparent';
      case 2: return 'bg-gradient-to-r from-amber-600/10 to-transparent';
      default: return '';
    }
  };
  
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${getRankBg()} hover:bg-white/5 transition-colors`}>
      {/* Rank */}
      <div className="w-8 flex justify-center">
        {getRankIcon()}
      </div>
      
      {/* Player Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-white text-sm truncate">
            {entry.displayName}
          </span>
          {entry.isOnline && (
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" title="Online" />
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-white/40 mt-0.5">
          <span>{entry.totalWins} wins</span>
          <span>{entry.winRate.toFixed(1)}% WR</span>
        </div>
      </div>
      
      {/* Stats */}
      <div className="text-right">
        <div className={`font-bold font-mono ${entry.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {entry.netProfit >= 0 ? '+' : ''}{entry.netProfit.toFixed(0)}
        </div>
        <div className="text-[10px] text-white/30">
          Best: +{entry.biggestWin.toFixed(0)}
        </div>
      </div>
    </div>
  );
}

function RecentWinsTab({ recentWins }: { recentWins: RecentWin[] }) {
  if (recentWins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-white/40">
        <Flame size={48} className="mb-4 opacity-30" />
        <p className="text-sm">No recent wins</p>
        <p className="text-xs mt-1">Wins will appear here in real-time!</p>
      </div>
    );
  }
  
  return (
    <div className="divide-y divide-pink-500/10">
      {recentWins.map((win, index) => (
        <RecentWinRow key={`${win.walletAddress}-${win.timestamp}`} win={win} isNew={index === 0} />
      ))}
    </div>
  );
}

function RecentWinRow({ win, isNew }: { win: RecentWin; isNew: boolean }) {
  const timeAgo = getTimeAgo(win.timestamp);
  
  return (
    <div 
      className={`flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors ${
        isNew ? 'animate-pulse bg-green-500/10' : ''
      }`}
    >
      {/* Icon */}
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500/20 to-green-600/20 flex items-center justify-center">
        <TrendingUp size={18} className="text-green-400" />
      </div>
      
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="font-mono text-white text-sm truncate">
          {win.displayName}
        </div>
        <div className="text-xs text-white/40 mt-0.5">
          {timeAgo}
        </div>
      </div>
      
      {/* Amount */}
      <div className="text-right">
        <div className="font-bold text-green-400 font-mono">
          +{win.amount.toFixed(0)}
        </div>
        <div className="text-[10px] text-yellow-400/70">
          {win.multiplier}x
        </div>
      </div>
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

