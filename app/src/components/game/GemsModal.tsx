'use client';

/**
 * GemsModal - Buy and sell gems overlay
 * 
 * SEAMLESS FLOW (like waddle.bet):
 * 1. User clicks buy amount
 * 2. Phantom popup opens with transaction details
 * 3. User approves → SOL sent automatically
 * 4. Server verifies signature → Gems credited
 */

import { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Gem, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  Loader2,
  AlertCircle,
  Check,
  Info
} from 'lucide-react';
import { useWallet } from '@/contexts/WalletContext';
import SolanaLogo from '@/components/ui/SolanaLogo';
import PhantomWallet from '@/lib/wallet/PhantomWallet';

interface GemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectWallet: () => void;
}

interface PendingWithdrawal {
  withdrawalId: string;
  gemsAmount: number;
  solAmount: number;
  queuePosition: number | null;
  status: string;
  requestedAt: string;
  canCancel: boolean;
}

interface RatesData {
  gemsPerSol: number;
  feePercent: number;
  minWithdrawalGems: number;
  minDepositSol: number;
  custodialWallet: string;
  pendingWithdrawal?: PendingWithdrawal | null;
}

// Pre-defined purchase amounts
const PURCHASE_AMOUNTS = [
  { sol: 0.05, label: '0.05 SOL' },
  { sol: 0.1, label: '0.1 SOL' },
  { sol: 0.5, label: '0.5 SOL' },
  { sol: 1, label: '1 SOL' },
];

type Tab = 'buy' | 'sell';

export default function GemsModal({ isOpen, onClose, onConnectWallet }: GemsModalProps) {
  const { isAuthenticated, walletAddress, gemsBalance, authToken, refreshBalance } = useWallet();
  
  const [activeTab, setActiveTab] = useState<Tab>('buy');
  const [rates, setRates] = useState<RatesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Buy state
  const [selectedAmount, setSelectedAmount] = useState<number>(0.1);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [isPurchasing, setIsPurchasing] = useState(false);
  
  // Sell state
  const [withdrawAmount, setWithdrawAmount] = useState<string>('100');
  const [withdrawing, setWithdrawing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pendingWithdrawal, setPendingWithdrawal] = useState<PendingWithdrawal | null>(null);

  // Fetch rates on open
  useEffect(() => {
    if (isOpen) {
      fetchRates();
      setError(null);
      setSuccess(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, authToken]);

  const fetchRates = async () => {
    try {
      const response = await fetch('/api/rates');
      if (response.ok) {
        const data = await response.json();
        setRates(data);
      }
    } catch {
      // Use defaults
      setRates({
        gemsPerSol: 1000,
        feePercent: 2,
        minWithdrawalGems: 100,
        minDepositSol: 0.01,
        custodialWallet: ''
      });
    }
    
    // Also fetch pending withdrawal status if authenticated
    if (authToken) {
      try {
        const withdrawResponse = await fetch('/api/transactions/withdraw', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (withdrawResponse.ok) {
          const data = await withdrawResponse.json();
          setPendingWithdrawal(data.pendingWithdrawal || null);
        }
      } catch {
        // Ignore errors
      }
    }
  };

  /**
   * SEAMLESS PURCHASE FLOW:
   * 1. Build SOL transfer transaction
   * 2. Open Phantom popup for approval
   * 3. Send signature to server for verification
   * 4. Server credits gems
   */
  const handlePurchase = useCallback(async (solAmount: number) => {
    if (!isAuthenticated || !authToken || !rates?.custodialWallet) {
      setError('Please connect your wallet first');
      return;
    }
    
    if (solAmount < rates.minDepositSol) {
      setError(`Minimum deposit is ${rates.minDepositSol} SOL`);
      return;
    }
    
    setIsPurchasing(true);
    setError(null);
    setSuccess(null);
    
    try {
      const wallet = PhantomWallet.getInstance();
      
      if (!wallet.isConnected()) {
        throw new Error('Wallet not connected');
      }
      
      console.log(`💎 Purchasing gems for ${solAmount} SOL`);
      
      // Send SOL directly via Phantom (seamless popup)
      const result = await wallet.sendSOL(
        rates.custodialWallet,
        solAmount,
        `Euphoria: Purchase ${Math.floor(solAmount * rates.gemsPerSol)} Gems`
      );
      
      if (!result.success) {
        throw new Error(result.message || result.error || 'Transaction failed');
      }
      
      console.log(`💎 Deposit tx: ${result.signature}`);
      
      // Verify with server
      const verifyResponse = await fetch('/api/transactions/deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ txSignature: result.signature })
      });
      
      const verifyData = await verifyResponse.json();
      
      if (verifyResponse.ok && verifyData.success) {
        const gemsReceived = verifyData.transaction?.gemsAmount || Math.floor(solAmount * rates.gemsPerSol);
        setSuccess(`+${gemsReceived.toLocaleString()} gems added!`);
        refreshBalance();
        
        // Auto-clear success after 3s
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error(verifyData.error || 'Verification failed');
      }
      
    } catch (err) {
      console.error('Purchase error:', err);
      
      let userMessage = (err as Error).message || 'Transaction failed';
      if (userMessage.includes('User rejected') || userMessage.includes('cancelled')) {
        userMessage = 'Transaction cancelled';
      } else if (userMessage.includes('insufficient') || userMessage.includes('Insufficient')) {
        userMessage = 'Insufficient SOL balance';
      }
      
      setError(userMessage);
    } finally {
      setIsPurchasing(false);
    }
  }, [isAuthenticated, authToken, rates, refreshBalance]);

  const handleWithdraw = async () => {
    if (!authToken || !rates) return;
    
    const amount = parseInt(withdrawAmount);
    if (isNaN(amount) || amount < rates.minWithdrawalGems) {
      setError(`Minimum withdrawal is ${rates.minWithdrawalGems} gems`);
      return;
    }
    
    if (amount > gemsBalance) {
      setError('Insufficient gems balance');
      return;
    }
    
    setWithdrawing(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch('/api/transactions/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ gemsAmount: amount })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        if (data.status === 'queued') {
          setSuccess(`Queued at #${data.queuePosition}. You'll receive ${data.transaction?.solAmount?.toFixed(4) || '?'} SOL when funds are available.`);
          // Update pending withdrawal state
          setPendingWithdrawal({
            withdrawalId: data.withdrawalId,
            gemsAmount: amount,
            solAmount: data.transaction?.solAmount || 0,
            queuePosition: data.queuePosition,
            status: 'pending',
            requestedAt: new Date().toISOString(),
            canCancel: true
          });
        } else {
          const solReceived = (amount / rates.gemsPerSol) * (1 - rates.feePercent / 100);
          setSuccess(`Withdrawal complete! ${solReceived.toFixed(4)} SOL sent.`);
        }
        setWithdrawAmount('100');
        refreshBalance();
      } else {
        setError(data.error || 'Withdrawal failed');
      }
    } catch {
      setError('Network error - please try again');
    } finally {
      setWithdrawing(false);
    }
  };

  const handleCancelWithdrawal = async () => {
    if (!authToken || !pendingWithdrawal) return;
    
    setCancelling(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch('/api/transactions/withdraw/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        setSuccess(data.message || `Withdrawal cancelled. ${data.gemsRefunded} gems refunded.`);
        setPendingWithdrawal(null);
        refreshBalance();
      } else {
        setError(data.error || 'Failed to cancel withdrawal');
      }
    } catch {
      setError('Network error - please try again');
    } finally {
      setCancelling(false);
    }
  };

  if (!isOpen) return null;

  const effectiveAmount = customAmount ? parseFloat(customAmount) : selectedAmount;
  const gemsFromDeposit = rates ? Math.floor(effectiveAmount * rates.gemsPerSol) : 0;
  const solFromWithdraw = rates ? (parseInt(withdrawAmount || '0') / rates.gemsPerSol) : 0;
  const feeAmount = rates ? solFromWithdraw * (rates.feePercent / 100) : 0;
  const netSolFromWithdraw = solFromWithdraw - feeAmount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-md bg-gradient-to-br from-[#1a0a2e] to-[#0a0014] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl">
                <Gem size={20} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Gems Exchange</h2>
                <p className="text-xs text-white/50">Buy & sell gems</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
              <X size={20} className="text-white/60" />
            </button>
          </div>
        </div>

        {/* Balance Display */}
        <div className="p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-b border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-white/60 text-sm">Your Balance</span>
            <div className="flex items-center gap-2">
              <Gem size={18} className="text-purple-400" />
              <span className="text-2xl font-bold font-mono text-white">
                {isAuthenticated ? gemsBalance.toLocaleString() : '---'}
              </span>
            </div>
          </div>
          
          {/* Conversion Rate */}
          {rates && (
            <div className="mt-3 flex items-center gap-2 text-xs text-white/50">
              <Info size={12} />
              <span>1 SOL = {rates.gemsPerSol.toLocaleString()} Gems • {rates.feePercent}% withdrawal fee</span>
            </div>
          )}
        </div>

        {/* Not Authenticated */}
        {!isAuthenticated ? (
          <div className="p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-500/20 flex items-center justify-center">
              <Gem size={32} className="text-purple-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Connect Wallet</h3>
            <p className="text-white/60 text-sm mb-4">
              Connect your Phantom wallet to buy and sell gems
            </p>
            <button
              onClick={onConnectWallet}
              className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl text-white font-semibold hover:opacity-90 transition-opacity"
            >
              Connect Wallet
            </button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex border-b border-white/10">
              <button
                onClick={() => { setActiveTab('buy'); setError(null); setSuccess(null); }}
                className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  activeTab === 'buy' 
                    ? 'text-green-400 border-b-2 border-green-400 bg-green-400/5' 
                    : 'text-white/50 hover:text-white/80'
                }`}
              >
                <ArrowDownToLine size={16} />
                Buy Gems
              </button>
              <button
                onClick={() => { setActiveTab('sell'); setError(null); setSuccess(null); }}
                className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  activeTab === 'sell' 
                    ? 'text-orange-400 border-b-2 border-orange-400 bg-orange-400/5' 
                    : 'text-white/50 hover:text-white/80'
                }`}
              >
                <ArrowUpFromLine size={16} />
                Sell Gems
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              {/* Error/Success Messages */}
              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}
              {success && (
                <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center gap-2 text-green-400 text-sm">
                  <Check size={16} />
                  {success}
                </div>
              )}

              {activeTab === 'buy' ? (
                /* BUY TAB - Seamless Phantom flow */
                <div className="space-y-4">
                  {/* Quick Amount Buttons */}
                  <div>
                    <label className="text-xs text-white/50 mb-2 block">Select amount</label>
                    <div className="grid grid-cols-4 gap-2">
                      {PURCHASE_AMOUNTS.map(({ sol, label }) => (
                        <button
                          key={sol}
                          onClick={() => { setSelectedAmount(sol); setCustomAmount(''); }}
                          disabled={isPurchasing}
                          className={`py-3 rounded-lg text-sm font-bold transition-all ${
                            selectedAmount === sol && !customAmount
                              ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                              : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                          } disabled:opacity-50`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Amount */}
                  <div>
                    <label className="text-xs text-white/50 mb-2 block">Or enter custom amount</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        placeholder="Custom SOL"
                        step="0.01"
                        min="0.01"
                        disabled={isPurchasing}
                        className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white font-mono focus:outline-none focus:border-green-500/50 disabled:opacity-50"
                      />
                      <SolanaLogo size={20} className="text-white/40" />
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-white/60 text-sm">You pay</div>
                        <div className="text-xl font-bold text-white flex items-center gap-2">
                          <SolanaLogo size={20} />
                          {effectiveAmount.toFixed(2)} SOL
                        </div>
                      </div>
                      <div className="text-3xl text-white/30">→</div>
                      <div className="text-right">
                        <div className="text-white/60 text-sm">You receive</div>
                        <div className="text-xl font-bold text-green-400 flex items-center gap-2 justify-end">
                          <Gem size={20} />
                          {gemsFromDeposit.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Buy Button */}
                  <button
                    onClick={() => handlePurchase(effectiveAmount)}
                    disabled={isPurchasing || effectiveAmount < (rates?.minDepositSol || 0.01)}
                    className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl text-white font-bold text-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isPurchasing ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        Approve in Phantom...
                      </>
                    ) : (
                      <>
                        <Gem size={20} />
                        Buy {gemsFromDeposit.toLocaleString()} Gems
                      </>
                    )}
                  </button>

                  <p className="text-xs text-white/40 text-center">
                    Phantom will open to approve the transaction
                  </p>
                </div>
              ) : (
                /* SELL TAB */
                <div className="space-y-4">
                  {/* Pending Withdrawal Banner */}
                  {pendingWithdrawal && (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Loader2 size={16} className="animate-spin text-yellow-400" />
                            <span className="font-semibold text-yellow-400">
                              {pendingWithdrawal.status === 'processing' ? 'Processing...' : 'Queued'}
                            </span>
                            {pendingWithdrawal.queuePosition && (
                              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 text-xs rounded-full font-bold">
                                #{pendingWithdrawal.queuePosition} in queue
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-white/80">
                            <span className="font-mono">{pendingWithdrawal.gemsAmount.toLocaleString()}</span> gems → 
                            <span className="font-mono ml-1">{pendingWithdrawal.solAmount.toFixed(4)}</span> SOL
                          </div>
                          <div className="text-xs text-white/50 mt-1">
                            Requested {new Date(pendingWithdrawal.requestedAt).toLocaleString()}
                          </div>
                        </div>
                        {pendingWithdrawal.canCancel && (
                          <button
                            onClick={handleCancelWithdrawal}
                            disabled={cancelling}
                            className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-400 text-sm font-medium transition-colors disabled:opacity-50"
                          >
                            {cancelling ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              'Cancel'
                            )}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-white/40 mt-2">
                        {pendingWithdrawal.status === 'processing' 
                          ? 'Your withdrawal is being processed. Cannot cancel at this time.'
                          : 'Your withdrawal will process automatically when funds are available.'}
                      </p>
                    </div>
                  )}

                  {/* Hide withdraw form if there's a pending withdrawal */}
                  {!pendingWithdrawal ? (
                    <>
                      {/* Amount */}
                      <div>
                        <label className="text-xs text-white/50 mb-2 block">Gems to sell</label>
                        <div className="flex gap-2">
                          {['100', '500', '1000'].map(amt => (
                            <button
                              key={amt}
                              onClick={() => setWithdrawAmount(amt)}
                              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                                withdrawAmount === amt
                                  ? 'bg-orange-500 text-white'
                                  : 'bg-white/5 text-white/60 hover:bg-white/10'
                              }`}
                            >
                              {parseInt(amt).toLocaleString()}
                            </button>
                          ))}
                          <button
                            onClick={() => setWithdrawAmount(gemsBalance.toString())}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                              withdrawAmount === gemsBalance.toString()
                                ? 'bg-orange-500 text-white'
                                : 'bg-white/5 text-white/60 hover:bg-white/10'
                            }`}
                          >
                            Max
                          </button>
                        </div>
                        <input
                          type="number"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          className="mt-2 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white font-mono focus:outline-none focus:border-orange-500/50"
                          placeholder="Custom amount"
                          step="1"
                          min={rates?.minWithdrawalGems || 100}
                          max={gemsBalance}
                        />
                      </div>

                      {/* Preview */}
                      <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-white/60">Gross SOL</span>
                          <div className="flex items-center gap-1">
                            <SolanaLogo size={14} />
                            <span className="text-white">{solFromWithdraw.toFixed(4)}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-white/60">Fee ({rates?.feePercent || 2}%)</span>
                          <span className="text-red-400">-{feeAmount.toFixed(4)}</span>
                        </div>
                        <div className="border-t border-white/10 pt-2 flex items-center justify-between text-sm">
                          <span className="text-white/80 font-medium">You receive</span>
                          <div className="flex items-center gap-1">
                            <SolanaLogo size={14} />
                            <span className="font-bold text-white">{netSolFromWithdraw.toFixed(4)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Destination */}
                      <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                        <div className="text-xs text-white/50 mb-1">Sending to</div>
                        <code className="text-sm text-white/80 font-mono">{walletAddress}</code>
                      </div>

                      <button
                        onClick={handleWithdraw}
                        disabled={withdrawing || parseInt(withdrawAmount) > gemsBalance || parseInt(withdrawAmount) < (rates?.minWithdrawalGems || 100)}
                        className="w-full py-3 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {withdrawing ? (
                          <>
                            <Loader2 size={18} className="animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <ArrowUpFromLine size={18} />
                            Withdraw {netSolFromWithdraw.toFixed(4)} SOL
                          </>
                        )}
                      </button>

                      <p className="text-xs text-white/40 text-center">
                        Minimum withdrawal: {rates?.minWithdrawalGems || 100} gems • May be queued if funds low
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-white/50 text-center py-4">
                      You already have a pending withdrawal. Cancel it to request a new one.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
