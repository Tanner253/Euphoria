/**
 * JWT Authentication Service
 * Handles token creation and verification after x403 auth
 * 
 * SECURITY: JWT secret is never logged
 */

import jwt from 'jsonwebtoken';

// SECURITY: Never log the JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-in-production';
const JWT_EXPIRATION = '24h';

export interface JWTPayload {
  walletAddress: string;
  iat?: number;
  exp?: number;
}

/**
 * Create a JWT token for an authenticated user
 */
export function createToken(walletAddress: string): string {
  return jwt.sign(
    { walletAddress } as JWTPayload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRATION }
  );
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch {
    // SECURITY: Don't log token or error details - could expose secrets
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  return null;
}

/**
 * Middleware helper to get authenticated wallet from request
 */
export function getAuthenticatedWallet(authHeader: string | null): string | null {
  const token = extractToken(authHeader);
  if (!token) return null;
  
  const payload = verifyToken(token);
  return payload?.walletAddress || null;
}

