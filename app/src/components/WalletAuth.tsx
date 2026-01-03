'use client';

/**
 * WalletAuth - Phantom wallet authentication UI for Euphoria
 * Explains x403 auth, why it's safe, and handles the connection flow
 * Supports both desktop (extension) and mobile (Phantom app)
 * 
 * IMPORTANT: Clearly communicates to users that this is a READ-ONLY signature
 * and NO funds are being transferred.
 */

import React, { useState, useEffect } from 'react';
import { Shield, Info, Check, Wallet, ExternalLink, Loader2, X, AlertCircle } from 'lucide-react';
import PhantomWallet, { MobileStatus } from '@/lib/wallet/PhantomWallet';
import { useWallet } from '@/contexts/WalletContext';

interface WalletAuthProps {
  onClose?: () => void;
  onAuthSuccess?: () => void;
}

export default function WalletAuth({ onClose, onAuthSuccess }: WalletAuthProps) {
  const {
    isConnected,
    isConnecting,
    walletAddress,
    authError,
    connect,
    disconnect
  } = useWallet();
  
  const [showInfo, setShowInfo] = useState(false);
  const [mobileStatus, setMobileStatus] = useState<MobileStatus>({ 
    isMobile: false, 
    isPhantomBrowser: false,
    needsRedirect: false 
  });
  
  // Check mobile status on mount
  useEffect(() => {
    const wallet = PhantomWallet.getInstance();
    setMobileStatus(wallet.getMobileStatus());
  }, []);
  
  // Handle successful auth
  useEffect(() => {
    if (isConnected && walletAddress && onAuthSuccess) {
      onAuthSuccess();
    }
  }, [isConnected, walletAddress, onAuthSuccess]);
  
  const handleConnect = async () => {
    await connect();
  };
  
  const handleMobileRedirect = () => {
    const wallet = PhantomWallet.getInstance();
    wallet.openPhantomMobile();
  };
  
  const shortAddress = walletAddress 
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` 
    : '';

  // If already authenticated, show connected state
  if (isConnected && walletAddress) {
    return (
      <div className="bg-gradient-to-br from-green-900/40 to-emerald-900/40 rounded-2xl p-5 border border-green-500/30 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 
                          flex items-center justify-center shadow-lg shadow-green-500/30">
            <Check className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-green-400 font-bold text-lg">Connected</span>
              <span className="text-green-300/60 text-sm font-mono">{shortAddress}</span>
            </div>
            <div className="text-sm text-green-200/60 mt-0.5">
              Wallet authenticated • No funds at risk
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-white/50" />
            </button>
          )}
        </div>
        
        <button
          onClick={disconnect}
          className="mt-4 w-full px-4 py-2.5 bg-black/30 hover:bg-red-900/30 border border-white/10 
                     hover:border-red-500/30 rounded-xl text-white/60 hover:text-red-400 
                     text-sm transition-all font-medium"
        >
          Disconnect Wallet
        </button>
      </div>
    );
  }
  
  // Guest state - show connect UI
  return (
    <div className="bg-gradient-to-br from-purple-900/40 to-indigo-900/40 rounded-2xl border border-purple-500/30 overflow-hidden shadow-xl">
      {/* Header */}
      <div className="p-5 border-b border-purple-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600/50 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-purple-300" />
            </div>
            <div>
              <h3 className="text-white font-bold">Sign In with Phantom</h3>
              <p className="text-purple-300/60 text-sm">Read-only authentication</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowInfo(!showInfo)}
              className="p-2 text-purple-400 hover:text-purple-300 hover:bg-purple-500/20 rounded-lg transition-all"
              title="What is x403 authentication?"
            >
              <Info className="w-5 h-5" />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-white/50" />
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Info Panel (expandable) */}
      {showInfo && (
        <div className="px-5 py-4 bg-black/20 border-b border-purple-500/20">
          <h4 className="text-purple-300 font-semibold text-sm mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" /> What is x403 Authentication?
          </h4>
          <div className="space-y-3 text-sm text-white/70">
            <p>
              <strong className="text-purple-300">x403</strong> is a secure, gasless signature-based 
              authentication standard for Web3 apps. You simply sign a message to prove wallet ownership.
            </p>
            <div className="bg-black/30 rounded-xl p-4">
              <p className="text-green-400 font-semibold mb-2 flex items-center gap-2">
                <Check className="w-4 h-4" /> Why it&apos;s completely safe:
              </p>
              <ul className="space-y-2 text-white/60">
                <li className="flex items-start gap-2">
                  <span className="text-green-400 mt-0.5">✓</span>
                  <span><strong>No transactions</strong> – You&apos;re only signing a message, not approving any transfers</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 mt-0.5">✓</span>
                  <span><strong>No gas fees</strong> – Signing is completely free</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 mt-0.5">✓</span>
                  <span><strong>No token approvals</strong> – We cannot move your tokens or funds</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-400 mt-0.5">✓</span>
                  <span><strong>Read-only</strong> – Only proves you own the wallet</span>
                </li>
              </ul>
            </div>
            <p className="text-white/50 italic text-xs">
              Think of it like signing a guest book – it doesn&apos;t give anyone access to your wallet or funds.
            </p>
          </div>
        </div>
      )}
      
      {/* Safety Banner - Always Visible */}
      <div className="mx-5 mt-5 p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-green-400 text-sm mb-1">🔒 Read-Only Signature</h4>
            <p className="text-green-200/70 text-xs leading-relaxed">
              This signature <strong>only proves wallet ownership</strong>. 
              <span className="text-green-300"> No funds will be transferred.</span>
              {' '}No blockchain transactions. Just authentication.
            </p>
          </div>
        </div>
      </div>
      
      {/* Connect Button */}
      <div className="p-5">
        {/* Mobile - needs Phantom app */}
        {mobileStatus.isMobile && mobileStatus.needsRedirect ? (
          <div className="space-y-3">
            <button
              onClick={handleMobileRedirect}
              className="w-full flex items-center justify-center gap-2 px-5 py-3.5 
                         bg-gradient-to-r from-purple-600 to-indigo-600 
                         hover:from-purple-500 hover:to-indigo-500
                         rounded-xl text-white font-bold shadow-lg shadow-purple-500/25
                         border-b-4 border-purple-800 hover:border-purple-700
                         transition-all active:scale-[0.98] active:border-b-2"
            >
              <Wallet className="w-5 h-5" />
              Open in Phantom App
              <ExternalLink className="w-4 h-4" />
            </button>
            <p className="text-center text-xs text-purple-300/60">
              📱 Opens this page in Phantom&apos;s in-app browser
            </p>
          </div>
        ) : (
          /* Desktop or Phantom browser - direct connect */
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full flex items-center justify-center gap-2 px-5 py-3.5 
                       bg-gradient-to-r from-purple-600 to-indigo-600 
                       hover:from-purple-500 hover:to-indigo-500
                       disabled:from-slate-600 disabled:to-slate-700
                       rounded-xl text-white font-bold shadow-lg shadow-purple-500/25
                       border-b-4 border-purple-800 hover:border-purple-700
                       disabled:border-slate-800 transition-all
                       active:scale-[0.98] active:border-b-2"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Waiting for signature...
              </>
            ) : (
              <>
                <Wallet className="w-5 h-5" />
                Connect Phantom Wallet
              </>
            )}
          </button>
        )}
        
        {/* Error display */}
        {authError && (
          <div className="mt-4 p-4 rounded-xl border bg-red-900/30 border-red-500/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">
                {authError === 'PHANTOM_NOT_INSTALLED' ? (
                  mobileStatus.isMobile ? (
                    <>
                      Open this site in{' '}
                      <a 
                        href="https://phantom.app/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-purple-400 underline hover:text-purple-300"
                      >
                        Phantom App
                      </a>
                      {' '}to connect
                    </>
                  ) : (
                    <>
                      Phantom not found.{' '}
                      <a 
                        href="https://phantom.app/" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-purple-400 underline hover:text-purple-300"
                      >
                        Install Phantom →
                      </a>
                    </>
                  )
                ) : authError === 'MOBILE_REDIRECT_NEEDED' ? (
                  <>📱 Tap &quot;Open in Phantom App&quot; above to continue</>
                ) : authError === 'USER_REJECTED' ? (
                  'Signature cancelled. Click connect to try again.'
                ) : (
                  authError
                )}
              </p>
            </div>
          </div>
        )}
        
        {/* Demo mode note */}
        <p className="text-center text-xs text-white/40 mt-4">
          Or continue in demo mode (wallet features disabled)
        </p>
      </div>
    </div>
  );
}

