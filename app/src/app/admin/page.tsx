'use client';

/**
 * Admin Dashboard - DEVELOPMENT ONLY
 * 
 * Single-page comprehensive monitoring of all system data
 * Shows transactions, users, bets, alerts, and hourly/daily stats in real-time
 */

import { useEffect, useState, useCallback } from 'react';

// Types
interface DashboardData {
  timestamp: string;
  error?: string;
  stats: {
    users: { total: number; active24h: number; gemsInCirculation: number };
    sol: { totalDeposited: number; totalWithdrawn: number; pendingWithdrawals: number; netCustodialBalance: number; houseProfit: number };
    transactions: { totalDeposits: number; totalWithdrawals: number; pendingWithdrawals: number; failedCount: number };
    betting: { totalBets: number; totalWins: number; totalLosses: number; totalWagered: number; totalPaidOut: number; houseProfit: number; houseEdgePercent: number };
  } | null;
  hourly: {
    deposits: { count: number; sol: number };
    withdrawals: { count: number; sol: number };
    netFlow: number;
    bets: { total: number; wins: number; losses: number };
    gemsWon: number;
    gemsLost: number;
    houseProfit: number;
  };
  daily: {
    deposits: { count: number; sol: number };
    withdrawals: { count: number; sol: number };
    netFlow: number;
    bets: { total: number; wins: number; losses: number };
    gemsWon: number;
    gemsLost: number;
    houseProfit: number;
  };
  alerts: Array<{ type: 'error' | 'warning' | 'info'; message: string; timestamp: string; details?: unknown }>;
  transactions: Array<{
    id: string;
    type: 'deposit' | 'withdrawal';
    status: string;
    walletAddress: string;
    solAmount: number;
    gemsAmount: number;
    feeAmount: number;
    txSignature: string | null;
    createdAt: string;
    confirmedAt: string | null;
    notes?: string;
  }>;
  users: Array<{
    id: string;
    walletAddress: string;
    gemsBalance: number;
    totalDeposited: number;
    totalWithdrawn: number;
    totalBets: number;
    totalWins: number;
    totalLosses: number;
    winRate: number;
    netProfit: number;
    status: string;
    createdAt: string;
    lastActiveAt: string;
  }>;
  bets: Array<{
    id: string;
    walletAddress: string;
    amount: number;
    multiplier: number;
    potentialWin: number;
    actualWin: number;
    status: string;
    priceAtBet: number;
    priceAtResolution: number | null;
    createdAt: string;
    resolvedAt: string | null;
  }>;
  auditLog: Array<{
    id: string;
    action: string;
    description: string;
    walletAddress: string | null;
    createdAt: string;
  }>;
}

export default function AdminPage() {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string>('');
  const [isMounted, setIsMounted] = useState(false);
  
  // Prevent hydration mismatch by only rendering dynamic content after mount
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/admin');
      
      if (response.status === 403) {
        setIsAuthorized(false);
        return;
      }
      
      setIsAuthorized(true);
      const result = await response.json();
      setData(result);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Failed to fetch admin data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    
    if (autoRefresh) {
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, fetchData]);

  if (isAuthorized === false) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-2">Access Denied</h1>
          <p className="text-zinc-400">Admin panel is only available in development mode</p>
        </div>
      </div>
    );
  }

  const formatDate = (dateStr: string) => isMounted ? new Date(dateStr).toLocaleString() : '...';
  const formatSol = (sol: number) => `${sol.toFixed(4)} SOL`;
  const formatGems = (gems: number) => gems.toLocaleString();
  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
      confirmed: 'bg-green-500/20 text-green-400 border-green-500/30',
      pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
      failed: 'bg-red-500/20 text-red-400 border-red-500/30',
      won: 'bg-green-500/20 text-green-400 border-green-500/30',
      lost: 'bg-red-500/20 text-red-400 border-red-500/30',
      active: 'bg-green-500/20 text-green-400 border-green-500/30',
      suspended: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      banned: 'bg-red-500/20 text-red-400 border-red-500/30',
      expired: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colors[status] || 'bg-zinc-500/20 text-zinc-400'}`}>
        {status}
      </span>
    );
  };

  const AlertIcon = ({ type }: { type: string }) => {
    if (type === 'error') return <span className="text-red-400">⛔</span>;
    if (type === 'warning') return <span className="text-yellow-400">⚠️</span>;
    return <span className="text-blue-400">ℹ️</span>;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 pb-8">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent">
            Admin Dashboard
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Development Mode • Live Data • Last updated: {lastRefresh || '...'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800"
            />
            Auto-refresh (5s)
          </label>
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Error Banner with Setup Instructions */}
      {data?.error && (
        <div className="mb-6 bg-zinc-900/80 border border-red-500/30 rounded-xl overflow-hidden">
          <div className="bg-red-500/10 px-4 py-3 border-b border-red-500/20">
            <p className="text-red-400 font-medium">⚠️ {data.error}</p>
          </div>
          
          {(data.error.includes('MONGODB_URI') || data.error.includes('connect') || data.error.includes('Database')) && (
            <div className="p-4 text-sm">
              <h3 className="text-zinc-300 font-semibold mb-3">📋 MongoDB Setup Instructions</h3>
              
              <div className="space-y-4">
                <div>
                  <p className="text-zinc-400 mb-2">1. Make sure MongoDB is installed and running:</p>
                  <code className="block bg-zinc-800 text-green-400 px-3 py-2 rounded font-mono text-xs">
                    mongod
                  </code>
                </div>
                
                <div>
                  <p className="text-zinc-400 mb-2">2. Create a <code className="text-cyan-400">.env.local</code> file in the app root with:</p>
                  <pre className="bg-zinc-800 text-green-400 px-3 py-2 rounded font-mono text-xs overflow-x-auto">
{`MONGODB_URI=mongodb://localhost:27017/euphoria`}
                  </pre>
                </div>
                
                <div>
                  <p className="text-zinc-400 mb-2">3. Or use MongoDB Atlas (cloud):</p>
                  <pre className="bg-zinc-800 text-green-400 px-3 py-2 rounded font-mono text-xs overflow-x-auto">
{`MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/euphoria`}
                  </pre>
                </div>
                
                <div>
                  <p className="text-zinc-400 mb-2">4. Restart the Next.js dev server after adding .env.local</p>
                </div>
                
                <div className="pt-2 border-t border-zinc-700">
                  <p className="text-zinc-500 text-xs">
                    💡 The database and collections will be created automatically when you first connect.
                    You don&apos;t need to create them manually in MongoDB Compass.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alerts Section */}
      {data?.alerts && data.alerts.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3 text-red-400 flex items-center gap-2">
            🚨 Alerts ({data.alerts.length})
          </h2>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 divide-y divide-zinc-800 max-h-48 overflow-y-auto">
            {data.alerts.map((alert, i) => (
              <div key={i} className={`px-4 py-3 flex items-start gap-3 ${
                alert.type === 'error' ? 'bg-red-500/5' : alert.type === 'warning' ? 'bg-yellow-500/5' : ''
              }`}>
                <AlertIcon type={alert.type} />
                <div className="flex-1">
                  <p className={`text-sm ${
                    alert.type === 'error' ? 'text-red-300' : alert.type === 'warning' ? 'text-yellow-300' : 'text-zinc-300'
                  }`}>{alert.message}</p>
                  <p className="text-xs text-zinc-500 mt-1">{formatDate(alert.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* House Profit Banner */}
      <section className="mb-6">
        <div className="bg-gradient-to-r from-emerald-500/10 via-green-500/10 to-cyan-500/10 rounded-xl border border-emerald-500/30 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-emerald-400 mb-1">💰 House Profit (SOL)</h2>
              <p className="text-zinc-400 text-sm">Total Deposits - Total Withdrawals</p>
            </div>
            <div className="text-right">
              <p className={`text-4xl font-mono font-bold ${(data?.stats?.sol.houseProfit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(data?.stats?.sol.houseProfit || 0) >= 0 ? '+' : ''}{formatSol(data?.stats?.sol.houseProfit || 0)}
              </p>
              <p className="text-zinc-500 text-sm mt-1">
                {formatSol(data?.stats?.sol.totalDeposited || 0)} deposited − {formatSol(data?.stats?.sol.totalWithdrawn || 0)} withdrawn
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Overview Stats Grid */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3 text-zinc-300">📊 Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Total Users" value={data?.stats?.users.total || 0} />
          <StatCard label="Active (24h)" value={data?.stats?.users.active24h || 0} />
          <StatCard label="Gems in Circulation" value={formatGems(data?.stats?.users.gemsInCirculation || 0)} color="purple" />
          <StatCard label="Net Custodial SOL" value={formatSol(data?.stats?.sol.netCustodialBalance || 0)} color="green" />
          <StatCard label="Pending Withdrawals" value={formatSol(data?.stats?.sol.pendingWithdrawals || 0)} color="yellow" />
          <StatCard label="Failed Transactions" value={data?.stats?.transactions.failedCount || 0} color={data?.stats?.transactions.failedCount ? 'red' : 'default'} />
        </div>
      </section>

      {/* Hourly & Daily Stats */}
      <section className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hourly */}
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-md font-semibold mb-3 text-cyan-400">⏰ Last Hour</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-zinc-500">Deposits</p>
              <p className="text-green-400 font-mono">{data?.hourly?.deposits.count || 0} ({formatSol(data?.hourly?.deposits.sol || 0)})</p>
            </div>
            <div>
              <p className="text-zinc-500">Withdrawals</p>
              <p className="text-red-400 font-mono">{data?.hourly?.withdrawals.count || 0} ({formatSol(data?.hourly?.withdrawals.sol || 0)})</p>
            </div>
            <div>
              <p className="text-zinc-500">Net SOL Flow</p>
              <p className={`font-mono ${(data?.hourly?.netFlow || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(data?.hourly?.netFlow || 0) >= 0 ? '+' : ''}{formatSol(data?.hourly?.netFlow || 0)}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Bets (W/L)</p>
              <p className="font-mono">
                <span className="text-white">{data?.hourly?.bets.total || 0}</span>
                <span className="text-zinc-500"> (</span>
                <span className="text-green-400">{data?.hourly?.bets.wins || 0}</span>
                <span className="text-zinc-500">/</span>
                <span className="text-red-400">{data?.hourly?.bets.losses || 0}</span>
                <span className="text-zinc-500">)</span>
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Gems Won</p>
              <p className="text-green-400 font-mono">{formatGems(data?.hourly?.gemsWon || 0)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Gems Lost</p>
              <p className="text-red-400 font-mono">{formatGems(data?.hourly?.gemsLost || 0)}</p>
            </div>
            <div className="col-span-2 pt-2 border-t border-zinc-700">
              <p className="text-zinc-500">House Profit (Hour)</p>
              <p className={`text-lg font-mono font-bold ${(data?.hourly?.houseProfit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(data?.hourly?.houseProfit || 0) >= 0 ? '+' : ''}{formatGems(data?.hourly?.houseProfit || 0)} gems
              </p>
            </div>
          </div>
        </div>

        {/* Daily */}
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
          <h3 className="text-md font-semibold mb-3 text-purple-400">📅 Last 24 Hours</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-zinc-500">Deposits</p>
              <p className="text-green-400 font-mono">{data?.daily?.deposits.count || 0} ({formatSol(data?.daily?.deposits.sol || 0)})</p>
            </div>
            <div>
              <p className="text-zinc-500">Withdrawals</p>
              <p className="text-red-400 font-mono">{data?.daily?.withdrawals.count || 0} ({formatSol(data?.daily?.withdrawals.sol || 0)})</p>
            </div>
            <div>
              <p className="text-zinc-500">Net SOL Flow</p>
              <p className={`font-mono ${(data?.daily?.netFlow || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(data?.daily?.netFlow || 0) >= 0 ? '+' : ''}{formatSol(data?.daily?.netFlow || 0)}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Bets (W/L)</p>
              <p className="font-mono">
                <span className="text-white">{data?.daily?.bets.total || 0}</span>
                <span className="text-zinc-500"> (</span>
                <span className="text-green-400">{data?.daily?.bets.wins || 0}</span>
                <span className="text-zinc-500">/</span>
                <span className="text-red-400">{data?.daily?.bets.losses || 0}</span>
                <span className="text-zinc-500">)</span>
              </p>
            </div>
            <div>
              <p className="text-zinc-500">Gems Won</p>
              <p className="text-green-400 font-mono">{formatGems(data?.daily?.gemsWon || 0)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Gems Lost</p>
              <p className="text-red-400 font-mono">{formatGems(data?.daily?.gemsLost || 0)}</p>
            </div>
            <div className="col-span-2 pt-2 border-t border-zinc-700">
              <p className="text-zinc-500">House Profit (24h)</p>
              <p className={`text-lg font-mono font-bold ${(data?.daily?.houseProfit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(data?.daily?.houseProfit || 0) >= 0 ? '+' : ''}{formatGems(data?.daily?.houseProfit || 0)} gems
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Betting Stats */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3 text-zinc-300">🎰 All-Time Betting Stats</h2>
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 text-sm">
            <div>
              <p className="text-zinc-500">Total Bets</p>
              <p className="text-white font-mono text-lg">{data?.stats?.betting.totalBets || 0}</p>
            </div>
            <div>
              <p className="text-zinc-500">Total Wins</p>
              <p className="text-green-400 font-mono text-lg">{data?.stats?.betting.totalWins || 0}</p>
            </div>
            <div>
              <p className="text-zinc-500">Total Losses</p>
              <p className="text-red-400 font-mono text-lg">{data?.stats?.betting.totalLosses || 0}</p>
            </div>
            <div>
              <p className="text-zinc-500">Total Wagered</p>
              <p className="text-white font-mono text-lg">{formatGems(data?.stats?.betting.totalWagered || 0)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Total Paid Out</p>
              <p className="text-white font-mono text-lg">{formatGems(data?.stats?.betting.totalPaidOut || 0)}</p>
            </div>
            <div>
              <p className="text-zinc-500">House Profit</p>
              <p className={`font-mono text-lg ${(data?.stats?.betting.houseProfit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatGems(data?.stats?.betting.houseProfit || 0)}
              </p>
            </div>
            <div>
              <p className="text-zinc-500">House Edge</p>
              <p className={`font-mono text-lg ${(data?.stats?.betting.houseEdgePercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {data?.stats?.betting.houseEdgePercent || 0}%
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Three Column Layout for Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        {/* Transactions Table */}
        <section className="xl:col-span-1">
          <h2 className="text-lg font-semibold mb-3 text-zinc-300">💸 Recent Transactions</h2>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-800/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-zinc-400">Type</th>
                    <th className="px-3 py-2 text-left text-zinc-400">Wallet</th>
                    <th className="px-3 py-2 text-right text-zinc-400">SOL</th>
                    <th className="px-3 py-2 text-center text-zinc-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {data?.transactions?.map((tx) => (
                    <tr key={tx.id} className={`hover:bg-zinc-800/30 ${
                      tx.status === 'failed' || tx.status === 'cancelled' ? 'bg-red-500/5' : ''
                    }`}>
                      <td className="px-3 py-2">
                        <span className={tx.type === 'deposit' ? 'text-green-400' : 'text-red-400'}>
                          {tx.type === 'deposit' ? '↓' : '↑'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-zinc-300 font-mono">{truncateAddress(tx.walletAddress)}</td>
                      <td className="px-3 py-2 text-right font-mono">{tx.solAmount.toFixed(4)}</td>
                      <td className="px-3 py-2 text-center"><StatusBadge status={tx.status} /></td>
                    </tr>
                  ))}
                  {(!data?.transactions || data.transactions.length === 0) && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-zinc-500">No transactions</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Bets Table */}
        <section className="xl:col-span-1">
          <h2 className="text-lg font-semibold mb-3 text-zinc-300">🎲 Recent Bets</h2>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-800/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-zinc-400">Wallet</th>
                    <th className="px-3 py-2 text-right text-zinc-400">Amount</th>
                    <th className="px-3 py-2 text-right text-zinc-400">Win</th>
                    <th className="px-3 py-2 text-center text-zinc-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {data?.bets?.map((bet) => (
                    <tr key={bet.id} className="hover:bg-zinc-800/30">
                      <td className="px-3 py-2 text-zinc-300 font-mono">{truncateAddress(bet.walletAddress)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatGems(bet.amount)}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={bet.actualWin > 0 ? 'text-green-400' : 'text-zinc-500'}>
                          {formatGems(bet.actualWin)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center"><StatusBadge status={bet.status} /></td>
                    </tr>
                  ))}
                  {(!data?.bets || data.bets.length === 0) && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-zinc-500">No bets</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Audit Log */}
        <section className="xl:col-span-1">
          <h2 className="text-lg font-semibold mb-3 text-zinc-300">📜 Audit Log</h2>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="max-h-[400px] overflow-y-auto divide-y divide-zinc-800">
              {data?.auditLog?.map((log) => (
                <div key={log.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-purple-400 font-medium">{log.action}</span>
                    {log.walletAddress && (
                      <span className="text-zinc-500 font-mono">{truncateAddress(log.walletAddress)}</span>
                    )}
                  </div>
                  <p className="text-zinc-400 truncate">{log.description}</p>
                  <p className="text-zinc-600 text-[10px]">{formatDate(log.createdAt)}</p>
                </div>
              ))}
              {(!data?.auditLog || data.auditLog.length === 0) && (
                <div className="px-3 py-4 text-center text-zinc-500 text-sm">No audit logs</div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Users Table */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3 text-zinc-300">👥 Users</h2>
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 overflow-hidden">
          <div className="max-h-[400px] overflow-x-auto overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-800/50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-zinc-400">Wallet</th>
                  <th className="px-3 py-2 text-right text-zinc-400">Balance</th>
                  <th className="px-3 py-2 text-right text-zinc-400">Deposited</th>
                  <th className="px-3 py-2 text-right text-zinc-400">Withdrawn</th>
                  <th className="px-3 py-2 text-right text-zinc-400">Bets</th>
                  <th className="px-3 py-2 text-right text-zinc-400">Win Rate</th>
                  <th className="px-3 py-2 text-right text-zinc-400">Net P/L</th>
                  <th className="px-3 py-2 text-center text-zinc-400">Status</th>
                  <th className="px-3 py-2 text-right text-zinc-400">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {data?.users?.map((user) => (
                  <tr key={user.id} className="hover:bg-zinc-800/30">
                    <td className="px-3 py-2 text-zinc-300 font-mono">{truncateAddress(user.walletAddress)}</td>
                    <td className="px-3 py-2 text-right font-mono text-purple-400">{formatGems(user.gemsBalance)}</td>
                    <td className="px-3 py-2 text-right font-mono text-green-400">{formatSol(user.totalDeposited)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-400">{formatSol(user.totalWithdrawn)}</td>
                    <td className="px-3 py-2 text-right">{user.totalBets}</td>
                    <td className="px-3 py-2 text-right">{user.winRate}%</td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className={user.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {user.netProfit >= 0 ? '+' : ''}{formatGems(user.netProfit)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center"><StatusBadge status={user.status} /></td>
                    <td className="px-3 py-2 text-right text-zinc-500">{isMounted ? new Date(user.lastActiveAt).toLocaleDateString() : '...'}</td>
                  </tr>
                ))}
                {(!data?.users || data.users.length === 0) && (
                  <tr><td colSpan={9} className="px-3 py-4 text-center text-zinc-500">No users</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center text-zinc-600 text-xs py-4 border-t border-zinc-800">
        Admin Dashboard • Development Mode Only • {data?.timestamp ? formatDate(data.timestamp) : 'Loading...'}
      </footer>
    </div>
  );
}

// Stat Card Component
function StatCard({ label, value, color = 'default' }: { label: string; value: string | number; color?: string }) {
  const colorClasses: Record<string, string> = {
    default: 'text-white',
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
    purple: 'text-purple-400',
    cyan: 'text-cyan-400',
  };

  return (
    <div className="bg-zinc-900/50 rounded-lg border border-zinc-800 p-3">
      <p className="text-zinc-500 text-xs mb-1">{label}</p>
      <p className={`text-lg font-mono font-semibold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}
