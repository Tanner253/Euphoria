/**
 * MongoDB Connection Manager
 * Handles database connection with connection pooling for serverless environments
 * 
 * SECURITY: Uses secure logger to prevent credential exposure
 */

import { MongoClient, Db, MongoClientOptions } from 'mongodb';
import logger from '@/lib/utils/secureLogger';

// Environment validation - silent in production
const mongoConfigured = !!process.env.MONGODB_URI;
if (!mongoConfigured && process.env.NODE_ENV === 'development') {
  logger.warn('[MongoDB] MONGODB_URI not set - database features will be unavailable');
}

const MONGODB_URI = process.env.MONGODB_URI || '';

// Connection options optimized for MongoDB Atlas with SSL stability
const options: MongoClientOptions = {
  maxPoolSize: 5,              // Reduced for stability
  minPoolSize: 1,              // Minimal idle connections
  maxIdleTimeMS: 30000,        // Close idle connections faster
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 10000,
  retryWrites: true,           // Auto-retry failed writes
  retryReads: true,            // Auto-retry failed reads
  // SSL/TLS settings for Atlas stability
  tls: true,
  tlsAllowInvalidCertificates: false,
};

// Global cache for connection (prevents multiple connections in dev/serverless)
let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

// Connection mutex to prevent concurrent reconnection attempts
let connectionPromise: Promise<{ client: MongoClient; db: Db }> | null = null;

/**
 * Parse connection info from URI (without exposing credentials)
 */
function getConnectionInfo(uri: string): { host: string; database: string } {
  try {
    // Extract host and database without credentials
    const match = uri.match(/@([^/]+)\/([^?]+)/);
    if (match) {
      return { host: match[1], database: match[2] };
    }
    // For localhost without auth
    const localMatch = uri.match(/mongodb:\/\/([^/]+)\/([^?]+)/);
    if (localMatch) {
      return { host: localMatch[1], database: localMatch[2] };
    }
    return { host: 'unknown', database: 'unknown' };
  } catch {
    return { host: 'unknown', database: 'unknown' };
  }
}

/**
 * Internal connection logic with retries
 */
async function connectWithRetry(retries = 3): Promise<{ client: MongoClient; db: Db }> {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI not configured in .env.local');
  }

  const connInfo = getConnectionInfo(MONGODB_URI);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = new MongoClient(MONGODB_URI, options);
      await client.connect();
      
      // Database name is extracted from URI automatically, or use default
      const db = client.db();
      
      // Verify we can actually use the database
      await db.admin().ping();
      
      // Cache the connection
      cachedClient = client;
      cachedDb = db;
      
      // Only log database name, never connection string
      if (attempt > 1) {
        logger.info('[MongoDB] Connected after retry', { database: db.databaseName, attempt });
      } else {
        logger.info('[MongoDB] Connected', { database: db.databaseName });
      }
      
      return { client, db };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      const errorMessage = lastError.message;
      
      // Check if this is a retryable error (transient SSL/network issues)
      const isRetryable = 
        errorMessage.includes('SSL') ||
        errorMessage.includes('tls') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('pool was cleared') ||
        errorMessage.includes('topology was destroyed') ||
        errorMessage.includes('connection closed') ||
        errorMessage.includes('Client must be connected');
      
      if (isRetryable && attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
        logger.warn('[MongoDB] Transient error, retrying...', { attempt, delay, error: errorMessage.slice(0, 100) });
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Non-retryable or max retries reached
      break;
    }
  }

  // Provide helpful error messages without exposing credentials
  const errorMessage = lastError?.message || 'Unknown error';
  
  // Common error patterns
  if (errorMessage.includes('ECONNREFUSED')) {
    throw new Error(`Cannot connect to MongoDB at ${connInfo.host}. Is MongoDB running? Start it with: mongod`);
  }
  if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
    throw new Error(`MongoDB host not found: ${connInfo.host}. Check your MONGODB_URI.`);
  }
  if (errorMessage.includes('Authentication failed')) {
    throw new Error('MongoDB authentication failed. Check username/password in MONGODB_URI.');
  }
  if (errorMessage.includes('timed out')) {
    throw new Error(`MongoDB connection timed out. Host: ${connInfo.host}`);
  }
  if (errorMessage.includes('SSL') || errorMessage.includes('tls')) {
    throw new Error(`SSL/TLS connection error with MongoDB Atlas. This is usually temporary - please retry.`);
  }
  
  logger.error('[MongoDB] Connection failed after retries');
  throw new Error(`Database connection failed: ${errorMessage}`);
}

/**
 * Connect to MongoDB and return the database instance
 * Uses connection caching and mutex to prevent concurrent reconnection attempts
 */
export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  // Return cached connection if available and healthy
  if (cachedClient && cachedDb) {
    try {
      // Quick ping to verify connection is alive
      await cachedClient.db().admin().ping();
      return { client: cachedClient, db: cachedDb };
    } catch {
      // Connection is dead, need to reconnect
      logger.warn('[MongoDB] Cached connection lost, will reconnect');
      
      // Clear cache
      const oldClient = cachedClient;
      cachedClient = null;
      cachedDb = null;
      
      // Try to close old client in background (don't wait)
      oldClient?.close().catch(() => {});
    }
  }

  // If there's already a connection attempt in progress, wait for it
  // This prevents multiple concurrent reconnection attempts (thundering herd)
  if (connectionPromise) {
    try {
      return await connectionPromise;
    } catch {
      // Previous attempt failed, we'll try again below
      connectionPromise = null;
    }
  }

  // Start new connection attempt
  connectionPromise = connectWithRetry(3);
  
  try {
    const result = await connectionPromise;
    return result;
  } finally {
    // Clear the promise after it resolves (success or failure)
    connectionPromise = null;
  }
}

/**
 * Get the database instance (must be connected first)
 */
export function getDb(): Db {
  if (!cachedDb) {
    throw new Error('Database not connected. Call connectToDatabase() first.');
  }
  return cachedDb;
}

/**
 * Check if database is connected
 */
export function isConnected(): boolean {
  return cachedClient !== null && cachedDb !== null;
}

/**
 * Close the database connection
 */
export async function closeConnection(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
    logger.info('[MongoDB] Connection closed');
  }
}

/**
 * Initialize database collections and indexes
 * Should be called once on application startup
 */
export async function initializeDatabase(): Promise<void> {
  const { db } = await connectToDatabase();
  
  logger.info('[MongoDB] Initializing collections and indexes...');
  
  // Users collection
  const usersCollection = db.collection('users');
  await usersCollection.createIndex({ walletAddress: 1 }, { unique: true });
  await usersCollection.createIndex({ createdAt: -1 });
  await usersCollection.createIndex({ lastActiveAt: -1 });
  
  // Transactions collection (deposits, withdrawals)
  const transactionsCollection = db.collection('transactions');
  await transactionsCollection.createIndex({ walletAddress: 1 });
  await transactionsCollection.createIndex({ type: 1 });
  await transactionsCollection.createIndex({ status: 1 });
  await transactionsCollection.createIndex({ createdAt: -1 });
  await transactionsCollection.createIndex({ walletAddress: 1, createdAt: -1 });
  await transactionsCollection.createIndex({ txSignature: 1 }, { unique: true, sparse: true });
  
  // Bets collection
  const betsCollection = db.collection('bets');
  await betsCollection.createIndex({ walletAddress: 1 });
  await betsCollection.createIndex({ status: 1 });
  await betsCollection.createIndex({ createdAt: -1 });
  await betsCollection.createIndex({ walletAddress: 1, createdAt: -1 });
  await betsCollection.createIndex({ sessionId: 1 });
  
  // Sessions collection (for audit trail)
  const sessionsCollection = db.collection('sessions');
  await sessionsCollection.createIndex({ walletAddress: 1 });
  await sessionsCollection.createIndex({ createdAt: -1 });
  await sessionsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  
  // Audit log collection
  const auditCollection = db.collection('auditLog');
  await auditCollection.createIndex({ walletAddress: 1 });
  await auditCollection.createIndex({ action: 1 });
  await auditCollection.createIndex({ createdAt: -1 });
  await auditCollection.createIndex({ walletAddress: 1, action: 1, createdAt: -1 });
  
  logger.info('[MongoDB] Database initialization complete');
}
