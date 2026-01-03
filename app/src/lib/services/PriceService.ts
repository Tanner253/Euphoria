/**
 * Server-Side Price Service
 * 
 * SECURITY: Server fetches its own price - NEVER trust client-provided prices
 * Uses caching to prevent API spam while maintaining accuracy
 */

interface PriceData {
  price: number;
  timestamp: number;
  source: 'binance' | 'coinbase' | 'coingecko';
}

interface PriceCache {
  data: PriceData | null;
  fetchPromise: Promise<PriceData> | null;
}

// Cache configuration
const CACHE_TTL_MS = 500; // Cache price for 500ms
const FETCH_TIMEOUT_MS = 5000;

// Singleton cache
const cache: PriceCache = {
  data: null,
  fetchPromise: null,
};

/**
 * Fetch price from Binance API
 */
async function fetchFromBinance(): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  
  try {
    const response = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
      { signal: controller.signal }
    );
    
    if (!response.ok) throw new Error('Binance API error');
    
    const data = await response.json();
    return parseFloat(data.price);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch price from Coinbase API
 */
async function fetchFromCoinbase(): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  
  try {
    const response = await fetch(
      'https://api.coinbase.com/v2/prices/SOL-USD/spot',
      { signal: controller.signal }
    );
    
    if (!response.ok) throw new Error('Coinbase API error');
    
    const data = await response.json();
    return parseFloat(data.data.amount);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch price from CoinGecko API (backup)
 */
async function fetchFromCoinGecko(): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { signal: controller.signal }
    );
    
    if (!response.ok) throw new Error('CoinGecko API error');
    
    const data = await response.json();
    return data.solana.usd;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch price with fallback chain
 */
async function fetchPriceWithFallback(): Promise<PriceData> {
  const sources: Array<{ name: PriceData['source']; fetch: () => Promise<number> }> = [
    { name: 'binance', fetch: fetchFromBinance },
    { name: 'coinbase', fetch: fetchFromCoinbase },
    { name: 'coingecko', fetch: fetchFromCoinGecko },
  ];
  
  for (const source of sources) {
    try {
      const price = await source.fetch();
      
      if (isNaN(price) || price <= 0) {
        throw new Error('Invalid price');
      }
      
      return {
        price,
        timestamp: Date.now(),
        source: source.name,
      };
    } catch {
      // Try next source
      continue;
    }
  }
  
  throw new Error('All price sources failed');
}

/**
 * Get current SOL price (cached)
 * 
 * SECURITY: This is the ONLY source of truth for prices in bet resolution
 */
export async function getServerPrice(): Promise<PriceData> {
  const now = Date.now();
  
  // Return cached price if still valid
  if (cache.data && (now - cache.data.timestamp) < CACHE_TTL_MS) {
    return cache.data;
  }
  
  // If there's already a fetch in progress, wait for it
  if (cache.fetchPromise) {
    return cache.fetchPromise;
  }
  
  // Start new fetch
  cache.fetchPromise = fetchPriceWithFallback()
    .then((data) => {
      cache.data = data;
      cache.fetchPromise = null;
      return data;
    })
    .catch((error) => {
      cache.fetchPromise = null;
      
      // Return stale cache if available (better than nothing)
      if (cache.data) {
        return cache.data;
      }
      
      throw error;
    });
  
  return cache.fetchPromise;
}

/**
 * Get price or null (no throw)
 */
export async function getServerPriceSafe(): Promise<PriceData | null> {
  try {
    return await getServerPrice();
  } catch {
    return null;
  }
}

/**
 * Validate that a client-provided price is within acceptable range
 * Used to detect obvious manipulation attempts
 */
export function validateClientPrice(
  clientPrice: number,
  serverPrice: number,
  tolerancePercent: number = 1
): boolean {
  const diff = Math.abs(clientPrice - serverPrice) / serverPrice;
  return diff <= tolerancePercent / 100;
}

