/**
 * x403 Server-Side Verification
 * Verifies wallet signatures for authentication
 */

import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

interface X403Payload {
  version: string;
  action: 'authenticate';
  walletAddress: string;
  timestamp: number;
  nonce: string;
  domain: string;
  signature: string;
}

interface VerifyResult {
  valid: boolean;
  walletAddress?: string;
  error?: string;
}

/**
 * Reconstruct the message that was signed (must match client-side exactly)
 */
function reconstructMessage(payload: X403Payload, appName: string = 'Euphoria'): string {
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
 * Decode and verify an x403 authentication payload
 */
export function verifyX403Payload(
  encodedPayload: string,
  maxAgeMinutes: number = 10,
  appName: string = 'Euphoria'
): VerifyResult {
  try {
    // Decode the base64 payload
    const payloadJson = atob(encodedPayload);
    const payload: X403Payload = JSON.parse(payloadJson);
    
    // Validate structure
    if (!payload.walletAddress || !payload.signature || !payload.timestamp || !payload.nonce) {
      return { valid: false, error: 'Invalid payload structure' };
    }
    
    // Check timestamp (prevent replay attacks)
    const now = Date.now();
    const age = now - payload.timestamp;
    const maxAge = maxAgeMinutes * 60 * 1000;
    
    if (age > maxAge) {
      return { valid: false, error: 'Signature expired' };
    }
    
    if (age < -60000) { // 1 minute tolerance for clock skew
      return { valid: false, error: 'Invalid timestamp (future)' };
    }
    
    // Verify the wallet address is valid
    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(payload.walletAddress);
    } catch {
      return { valid: false, error: 'Invalid wallet address' };
    }
    
    // Reconstruct the original message that was signed
    const message = reconstructMessage(payload, appName);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(payload.signature);
    
    // Verify the signature
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );
    
    if (!isValid) {
      return { valid: false, error: 'Invalid signature' };
    }
    
    return { 
      valid: true, 
      walletAddress: payload.walletAddress 
    };
    
  } catch {
    // SECURITY: Don't log error details - could expose sensitive data
    return { valid: false, error: 'Verification failed' };
  }
}

/**
 * Check if a payload is still within validity window
 */
export function isPayloadFresh(encodedPayload: string, maxAgeMinutes: number = 10): boolean {
  try {
    const payloadJson = atob(encodedPayload);
    const payload = JSON.parse(payloadJson);
    
    if (!payload.timestamp) return false;
    
    const now = Date.now();
    const age = now - payload.timestamp;
    const maxAge = maxAgeMinutes * 60 * 1000;
    
    return age <= maxAge;
  } catch {
    return false;
  }
}


