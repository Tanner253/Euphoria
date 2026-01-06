/**
 * Global Chat System
 * 
 * Real-time chat via Socket.io.
 * Usernames are abbreviated wallet addresses.
 */

export interface ChatMessage {
  id: string;
  walletAddress: string;
  displayName: string;
  message: string;
  timestamp: number;
}

// Store recent messages (keep last 100)
const messages: ChatMessage[] = [];
const MAX_MESSAGES = 100;

// Rate limiting per wallet
const rateLimits = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const RATE_LIMIT_MAX = 5; // 5 messages per window

/**
 * Shorten wallet address for display
 */
function shortenWallet(address: string): string {
  if (!address || address.length <= 10) return address || 'Anon';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Generate unique message ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if wallet is rate limited
 */
function isRateLimited(walletAddress: string): boolean {
  const now = Date.now();
  const timestamps = rateLimits.get(walletAddress) || [];
  
  // Remove old timestamps
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  rateLimits.set(walletAddress, recent);
  
  return recent.length >= RATE_LIMIT_MAX;
}

/**
 * Record a message timestamp for rate limiting
 */
function recordMessage(walletAddress: string): void {
  const timestamps = rateLimits.get(walletAddress) || [];
  timestamps.push(Date.now());
  rateLimits.set(walletAddress, timestamps);
}

/**
 * Sanitize message content
 */
function sanitizeMessage(message: string): string {
  // Trim and limit length
  let sanitized = message.trim().slice(0, 200);
  
  // Remove any HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  
  return sanitized;
}

/**
 * Create and store a new chat message
 */
export function createMessage(
  walletAddress: string,
  message: string
): { success: boolean; message?: ChatMessage; error?: string } {
  // Check rate limit
  if (isRateLimited(walletAddress)) {
    return { success: false, error: 'Slow down! Too many messages.' };
  }
  
  // Sanitize message
  const sanitized = sanitizeMessage(message);
  if (!sanitized) {
    return { success: false, error: 'Message cannot be empty' };
  }
  
  // Create message
  const chatMessage: ChatMessage = {
    id: generateId(),
    walletAddress,
    displayName: shortenWallet(walletAddress),
    message: sanitized,
    timestamp: Date.now(),
  };
  
  // Store message
  messages.push(chatMessage);
  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }
  
  // Record for rate limiting
  recordMessage(walletAddress);
  
  return { success: true, message: chatMessage };
}

/**
 * Get recent messages
 */
export function getRecentMessages(limit: number = 50): ChatMessage[] {
  return messages.slice(-limit);
}

