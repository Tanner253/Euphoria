/**
 * Live Leaderboard Service
 * 
 * Fetches data from MongoDB and broadcasts via Socket.io.
 * NO POLLING - pure real-time push from server.
 */

import { connectToDatabase } from './database.js';

// ============ TYPES ============

export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  displayName: string;
  netProfit: number;
  totalWins: number;
  winRate: number;
  biggestWin: number;
  isOnline: boolean;
}

export interface RecentWin {
  walletAddress: string;
  displayName: string;
  amount: number;
  multiplier: string;
  timestamp: number;
}

export interface LiveStats {
  onlinePlayers: number;
  totalBetsToday: number;
  totalVolumeToday: number;
}

export interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  recentWins: RecentWin[];
  liveStats: LiveStats;
}

// Track online players (by wallet address)
const onlinePlayers = new Set<string>();

// ============ HELPER FUNCTIONS ============

function shortenWallet(address: string): string {
  if (!address || address.length <= 10) return address || 'Unknown';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// ============ PUBLIC API ============

/**
 * Set player online status
 */
export function setPlayerOnline(walletAddress: string, online: boolean): void {
  if (online) {
    onlinePlayers.add(walletAddress);
  } else {
    onlinePlayers.delete(walletAddress);
  }
}

/**
 * Get count of online players
 */
export function getOnlineCount(): number {
  return onlinePlayers.size;
}

/**
 * Fetch full leaderboard data from MongoDB
 */
export async function getLeaderboardData(): Promise<LeaderboardData> {
  try {
    const { db } = await connectToDatabase();
    
    // Get top players by net profit
    const users = await db.collection('users')
      .find({ totalBets: { $gt: 0 } })
      .sort({ totalWon: -1 })
      .limit(20)
      .toArray();
    
    // Calculate leaderboard entries
    const leaderboard: LeaderboardEntry[] = users
      .map((user, index) => {
        const netProfit = (user.totalWon || 0) - (user.totalLost || 0);
        const totalBets = (user.totalWins || 0) + (user.totalLosses || 0);
        const winRate = totalBets > 0 ? (user.totalWins / totalBets) * 100 : 0;
        
        return {
          rank: index + 1,
          walletAddress: user.walletAddress,
          displayName: shortenWallet(user.walletAddress),
          netProfit,
          totalWins: user.totalWins || 0,
          winRate: Math.round(winRate * 10) / 10,
          biggestWin: user.biggestWin || 0,
          isOnline: onlinePlayers.has(user.walletAddress),
        };
      })
      .sort((a, b) => b.netProfit - a.netProfit)
      .slice(0, 10)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
    
    // Get recent wins
    const recentBets = await db.collection('bets')
      .find({ status: 'won' })
      .sort({ resolvedAt: -1 })
      .limit(20)
      .toArray();
    
    const recentWins: RecentWin[] = recentBets.map(bet => ({
      walletAddress: bet.walletAddress,
      displayName: shortenWallet(bet.walletAddress),
      amount: bet.actualWin || bet.potentialWin || 0,
      multiplier: `${(bet.multiplier || 1).toFixed(2)}x`,
      timestamp: bet.resolvedAt ? new Date(bet.resolvedAt).getTime() : Date.now(),
    }));
    
    // Get live stats
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const betsToday = await db.collection('bets').aggregate([
      { $match: { createdAt: { $gte: oneDayAgo } } },
      { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$amount' } } }
    ]).toArray();
    
    const liveStats: LiveStats = {
      onlinePlayers: onlinePlayers.size,
      totalBetsToday: betsToday[0]?.count || 0,
      totalVolumeToday: betsToday[0]?.volume || 0,
    };
    
    return { leaderboard, recentWins, liveStats };
    
  } catch (error) {
    console.error('[Leaderboard] Failed to fetch data:', error);
    
    // Return empty data on error
    return {
      leaderboard: [],
      recentWins: [],
      liveStats: {
        onlinePlayers: onlinePlayers.size,
        totalBetsToday: 0,
        totalVolumeToday: 0,
      },
    };
  }
}

/**
 * Record a bet result (for real-time updates)
 * Called when a bet is resolved on the server
 */
export function createRecentWin(
  walletAddress: string,
  amount: number,
  multiplier: string
): RecentWin {
  return {
    walletAddress,
    displayName: shortenWallet(walletAddress),
    amount,
    multiplier,
    timestamp: Date.now(),
  };
}
