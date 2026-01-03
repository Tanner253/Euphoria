/**
 * X403Service - Client-side x403 authentication
 * Handles read-only signature-based authentication for Solana wallets
 * 
 * x403 Protocol Flow:
 * 1. Client creates authentication message (human-readable, for wallet display)
 * 2. User signs message with wallet (READ-ONLY - no funds transfer)
 * 3. Client creates payload with signature (ASCII-safe for base64)
 * 4. Server verifies signature and authenticates user
 * 
 * This is purely for authentication - no blockchain transactions occur
 */

import PhantomWallet from './PhantomWallet';

export interface AuthPayload {
  version: string;
  action: 'authenticate';
  walletAddress: string;
  timestamp: number;
  nonce: string;
  domain: string;
}

export interface AuthResult {
  success: boolean;
  payload?: string;
  authDetails?: AuthPayload;
  signature?: string;
  error?: string;
  message?: string;
}

class X403Service {
  private static instance: X403Service | null = null;
  private wallet: PhantomWallet;
  
  private constructor() {
    this.wallet = PhantomWallet.getInstance();
  }
  
  static getInstance(): X403Service {
    if (!X403Service.instance) {
      X403Service.instance = new X403Service();
    }
    return X403Service.instance;
  }
  
  /**
   * Check if wallet is ready for x403 authentication
   */
  isReady(): boolean {
    return this.wallet.isConnected();
  }
  
  /**
   * Get connected wallet address
   */
  getWalletAddress(): string | null {
    return this.wallet.getPublicKey();
  }
  
  /**
   * Create an authentication signature
   * This is a READ-ONLY operation - no funds are transferred
   * 
   * @param appName - Name of the application for display
   * @returns Promise with authentication result
   */
  async createAuthSignature(appName: string = 'Euphoria'): Promise<AuthResult> {
    if (!this.wallet.isConnected()) {
      return {
        success: false,
        error: 'WALLET_NOT_CONNECTED',
        message: 'Please connect your wallet first'
      };
    }
    
    try {
      const walletAddress = this.wallet.getPublicKey()!;
      const timestamp = Date.now();
      const nonce = this._generateNonce();
      const domain = typeof window !== 'undefined' ? window.location.host : appName;
      
      // Create a human-readable message for signing
      // This is what the user sees in their wallet - CLEARLY stating read-only
      // Note: This message is NOT included in the payload (avoids Unicode/btoa issues)
      const humanReadableMessage = [
        `${appName} Authentication`,
        '----------------------------------------',
        '',
        'READ-ONLY SIGNATURE REQUEST',
        '',
        'This signature is ONLY for authentication.',
        '* NO funds will be transferred',
        '* NO blockchain transactions',
        '* NO token approvals',
        '',
        `Wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`,
        `Domain: ${domain}`,
        `Time: ${new Date(timestamp).toISOString()}`,
        `Nonce: ${nonce}`,
        '',
        '----------------------------------------',
        'By signing, you prove wallet ownership.',
        'This is free and completely safe.',
      ].join('\n');
      
      // Sign the message
      const signResult = await this.wallet.signMessage(humanReadableMessage);
      
      if (!signResult.success) {
        return {
          success: false,
          error: signResult.error,
          message: signResult.message
        };
      }
      
      // Create the authentication payload (ASCII-safe, no Unicode)
      // The message is NOT included - it can be reconstructed for verification
      const authPayload: AuthPayload = {
        version: '1.0',
        action: 'authenticate',
        walletAddress,
        timestamp,
        nonce,
        domain
      };
      
      // Create the full payload with signature
      const fullPayload = {
        ...authPayload,
        signature: signResult.signature
      };
      
      // Encode as base64 for transport (now safe - no Unicode)
      const encodedPayload = btoa(JSON.stringify(fullPayload));
      
      return {
        success: true,
        payload: encodedPayload,
        authDetails: authPayload,
        signature: signResult.signature
      };
      
    } catch (error) {
      console.error('x403 authentication error:', error);
      return {
        success: false,
        error: 'AUTH_FAILED',
        message: (error as Error).message || 'Failed to create authentication'
      };
    }
  }
  
  /**
   * Reconstruct the message that was signed (for server-side verification)
   */
  static reconstructMessage(payload: AuthPayload, appName: string = 'Euphoria'): string {
    return [
      `${appName} Authentication`,
      '----------------------------------------',
      '',
      'READ-ONLY SIGNATURE REQUEST',
      '',
      'This signature is ONLY for authentication.',
      '* NO funds will be transferred',
      '* NO blockchain transactions',
      '* NO token approvals',
      '',
      `Wallet: ${payload.walletAddress.slice(0, 8)}...${payload.walletAddress.slice(-4)}`,
      `Domain: ${payload.domain}`,
      `Time: ${new Date(payload.timestamp).toISOString()}`,
      `Nonce: ${payload.nonce}`,
      '',
      '----------------------------------------',
      'By signing, you prove wallet ownership.',
      'This is free and completely safe.',
    ].join('\n');
  }
  
  /**
   * Decode an authentication payload (for display/verification)
   */
  decodePayload(encodedPayload: string): (AuthPayload & { signature: string }) | null {
    try {
      return JSON.parse(atob(encodedPayload));
    } catch (error) {
      console.error('Failed to decode payload:', error);
      return null;
    }
  }
  
  /**
   * Check if an authentication payload is still valid (within time window)
   * @param encodedPayload - Base64 encoded payload
   * @param validityMinutes - How long the auth is valid (default 30 mins)
   */
  isPayloadValid(encodedPayload: string, validityMinutes: number = 30): boolean {
    const payload = this.decodePayload(encodedPayload);
    if (!payload || !payload.timestamp) return false;
    
    const now = Date.now();
    const validUntil = payload.timestamp + (validityMinutes * 60 * 1000);
    return now <= validUntil;
  }
  
  /**
   * Generate a unique nonce for authentication
   */
  private _generateNonce(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

export default X403Service;

