/**
 * PhantomWallet - Handles Phantom wallet connection and signing
 * Supports both desktop (extension) and mobile (deep links)
 * For Solana wallet authentication (x403 - read-only signature, no funds transfer)
 */

import bs58 from 'bs58';

// Type declarations for Phantom wallet
interface PhantomProvider {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array, encoding: string) => Promise<{ signature: Uint8Array }>;
  signTransaction: (transaction: unknown) => Promise<unknown>;
  sendTransaction: (transaction: unknown, connection: unknown, options?: unknown) => Promise<string>;
  on: (event: string, callback: (data?: unknown) => void) => void;
  off: (event: string, callback: (data?: unknown) => void) => void;
}

declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

// Detect mobile device
const isMobile = (): boolean => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
};

// Check if we're inside Phantom's in-app browser
const isPhantomBrowser = (): boolean => {
  if (typeof window === 'undefined') return false;
  return !!(window.solana && window.solana.isPhantom);
};

type EventCallback = (data?: unknown) => void;

export interface ConnectResult {
  success: boolean;
  publicKey?: string;
  error?: string;
  message?: string;
  mobileRedirect?: boolean;
  phantomUrl?: string;
  installUrl?: string;
}

export interface SignMessageResult {
  success: boolean;
  signature?: string;
  error?: string;
  message?: string;
}

export interface MobileStatus {
  isMobile: boolean;
  isPhantomBrowser: boolean;
  needsRedirect: boolean;
}

export interface SendSOLResult {
  success: boolean;
  signature?: string;
  error?: string;
  message?: string;
}

class PhantomWallet {
  private static instance: PhantomWallet | null = null;
  
  private connected: boolean = false;
  private publicKey: string | null = null;
  private listeners: Map<string, EventCallback[]> = new Map();
  private isMobileDevice: boolean = false;
  
  private constructor() {
    if (typeof window !== 'undefined') {
      this.isMobileDevice = isMobile();
    }
  }
  
  static getInstance(): PhantomWallet {
    if (!PhantomWallet.instance) {
      PhantomWallet.instance = new PhantomWallet();
    }
    return PhantomWallet.instance;
  }
  
  /**
   * Check if Phantom extension is installed (desktop) or in Phantom browser (mobile)
   */
  isPhantomInstalled(): boolean {
    return typeof window !== 'undefined' && 
      !!(window.solana && window.solana.isPhantom);
  }
  
  /**
   * Get the Phantom provider
   */
  getProvider(): PhantomProvider | null {
    if (this.isPhantomInstalled()) {
      return window.solana!;
    }
    return null;
  }
  
  /**
   * Check if mobile deep link connection is needed
   */
  needsMobileDeepLink(): boolean {
    return this.isMobileDevice && !this.isPhantomInstalled();
  }
  
  /**
   * Get Phantom mobile deep link URL
   * Opens Phantom app on mobile if installed
   */
  getPhantomDeepLink(): string {
    const currentUrl = encodeURIComponent(window.location.href);
    return `https://phantom.app/ul/browse/${currentUrl}`;
  }
  
  /**
   * Open Phantom app on mobile (redirect)
   */
  openPhantomMobile(): void {
    const deepLink = this.getPhantomDeepLink();
    console.log('📱 Opening Phantom mobile app...');
    window.location.href = deepLink;
  }
  
  /**
   * Connect to Phantom wallet
   */
  async connect(): Promise<ConnectResult> {
    const provider = this.getProvider();
    
    if (provider) {
      try {
        // Request connection
        const response = await provider.connect();
        this.publicKey = response.publicKey.toString();
        this.connected = true;
        
        // Set up event listeners
        provider.on('disconnect', () => {
          this.connected = false;
          this.publicKey = null;
          this.emit('disconnect');
        });
        
        provider.on('accountChanged', (publicKey) => {
          if (publicKey) {
            this.publicKey = (publicKey as { toString: () => string }).toString();
            this.emit('accountChanged', this.publicKey);
          } else {
            this.connected = false;
            this.publicKey = null;
            this.emit('disconnect');
          }
        });
        
        this.emit('connect', this.publicKey);
        console.log(`🔐 Phantom connected: ${this.publicKey.slice(0, 8)}...`);
        
        return {
          success: true,
          publicKey: this.publicKey
        };
      } catch (error) {
        const err = error as { code?: number; message?: string };
        console.error('Phantom connect error:', error);
        
        // User rejected
        if (err.code === 4001) {
          return {
            success: false,
            error: 'USER_REJECTED',
            message: 'Connection rejected by user'
          };
        }
        
        return {
          success: false,
          error: String(err.code) || 'CONNECTION_FAILED',
          message: err.message || 'Failed to connect to Phantom'
        };
      }
    }
    
    // Mobile - need to redirect to Phantom app
    if (this.isMobileDevice) {
      return {
        success: false,
        error: 'MOBILE_REDIRECT_NEEDED',
        message: 'Please open this site in the Phantom app browser',
        mobileRedirect: true,
        phantomUrl: this.getPhantomDeepLink()
      };
    }
    
    // Desktop - Phantom not installed
    return {
      success: false,
      error: 'PHANTOM_NOT_INSTALLED',
      message: 'Phantom wallet extension is not installed',
      installUrl: 'https://phantom.app/'
    };
  }
  
  /**
   * Disconnect from Phantom
   */
  async disconnect(): Promise<void> {
    const provider = this.getProvider();
    
    if (provider && this.connected) {
      try {
        await provider.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    
    this.connected = false;
    this.publicKey = null;
    this.emit('disconnect');
  }
  
  /**
   * Sign a message for authentication (x403 - read-only, no funds transfer)
   * @param message - The message to sign (from server challenge)
   */
  async signMessage(message: string): Promise<SignMessageResult> {
    const provider = this.getProvider();
    
    if (!provider || !this.connected) {
      return {
        success: false,
        error: 'NOT_CONNECTED',
        message: 'Wallet not connected'
      };
    }
    
    try {
      // Encode message to bytes
      const messageBytes = new TextEncoder().encode(message);
      
      // Sign the message
      const signedMessage = await provider.signMessage(messageBytes, 'utf8');
      
      // Convert signature to base58
      const signature = bs58.encode(signedMessage.signature);
      
      return {
        success: true,
        signature
      };
    } catch (error) {
      const err = error as { code?: number; message?: string };
      console.error('Sign message error:', error);
      
      // User rejected the signature
      if (err.code === 4001) {
        return {
          success: false,
          error: 'USER_REJECTED',
          message: 'User rejected the signature request'
        };
      }
      
      return {
        success: false,
        error: String(err.code) || 'SIGN_FAILED',
        message: err.message || 'Failed to sign message'
      };
    }
  }
  
  /**
   * Send native SOL to a recipient (for deposits)
   * @param recipientAddress - Wallet address to send SOL to
   * @param amountSol - Amount in SOL (e.g., 0.1 = 0.1 SOL)
   * @param memo - Optional memo for the transaction
   */
  async sendSOL(recipientAddress: string, amountSol: number, memo?: string): Promise<SendSOLResult> {
    const provider = this.getProvider();
    
    if (!provider || !this.connected) {
      return {
        success: false,
        error: 'NOT_CONNECTED',
        message: 'Wallet not connected'
      };
    }
    
    try {
      // Dynamic import to avoid SSR issues
      const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      
      // Check for RPC URL - the public mainnet RPC blocks browser requests!
      const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
      
      if (!SOLANA_RPC_URL) {
        console.error('❌ NEXT_PUBLIC_SOLANA_RPC_URL not set!');
        console.error('   Get a FREE RPC from: https://dev.helius.xyz');
        console.error('   Add to .env.local: NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY');
        return {
          success: false,
          error: 'RPC_NOT_CONFIGURED',
          message: 'Solana RPC not configured. Please set NEXT_PUBLIC_SOLANA_RPC_URL in .env.local (get free key from helius.xyz)'
        };
      }
      
      console.log(`💸 Sending ${amountSol} SOL to ${recipientAddress.slice(0, 8)}...`);
      
      const connection = new Connection(SOLANA_RPC_URL, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000
      });
      
      const fromPubkey = new PublicKey(this.publicKey!);
      const toPubkey = new PublicKey(recipientAddress);
      const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      
      // Get latest blockhash
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      
      // Create transaction
      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: fromPubkey
      }).add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports
        })
      );
      
      // Note: Memo not added to avoid spl-memo dependency
      // Transaction will still work correctly without memo
      if (memo && memo.trim()) {
        console.log(`   (memo: ${memo.slice(0, 50)}...)`);
      }
      
      // Use Phantom's sendTransaction for better UX (shows details in popup)
      let signature: string;
      
      if (typeof provider.sendTransaction === 'function') {
        try {
          console.log('✍️ Opening Phantom transaction approval...');
          signature = await provider.sendTransaction(transaction, connection, {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          });
          console.log(`✅ SOL sent! Tx: ${signature}`);
        } catch (sendError) {
          // Fallback to sign + send
          console.warn('⚠️ sendTransaction failed, using fallback');
          const signedTx = await provider.signTransaction(transaction) as { serialize: () => Buffer };
          signature = await connection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          });
          console.log(`✅ SOL sent via fallback! Tx: ${signature}`);
        }
      } else {
        // Fallback: sign then send
        const signedTx = await provider.signTransaction(transaction) as { serialize: () => Buffer };
        signature = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        });
        console.log(`✅ SOL sent via fallback! Tx: ${signature}`);
      }
      
      return {
        success: true,
        signature
      };
      
    } catch (error) {
      const err = error as { code?: number; message?: string };
      console.error('Send SOL error:', error);
      
      if (err.code === 4001 || err.message?.includes('User rejected')) {
        return {
          success: false,
          error: 'USER_REJECTED',
          message: 'Transaction cancelled'
        };
      }
      
      if (err.message?.includes('insufficient') || err.message?.includes('Insufficient')) {
        return {
          success: false,
          error: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient SOL balance'
        };
      }
      
      return {
        success: false,
        error: String(err.code) || 'SEND_FAILED',
        message: err.message || 'Failed to send SOL'
      };
    }
  }

  /**
   * Get the current public key
   */
  getPublicKey(): string | null {
    return this.publicKey;
  }
  
  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.connected && this.publicKey !== null;
  }
  
  /**
   * Get mobile status
   */
  getMobileStatus(): MobileStatus {
    return {
      isMobile: this.isMobileDevice,
      isPhantomBrowser: isPhantomBrowser(),
      needsRedirect: this.needsMobileDeepLink()
    };
  }
  
  // Event system
  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
    return () => this.off(event, callback);
  }
  
  off(event: string, callback: EventCallback): void {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event)!;
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    }
  }
  
  emit(event: string, data?: unknown): void {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach(cb => cb(data));
    }
  }
}

export default PhantomWallet;

