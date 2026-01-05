'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface PriceUpdate {
  price: number;
  timestamp: number;
}

interface UseSolanaPriceOptions {
  /** Update interval in ms for output (default: 100ms) */
  updateIntervalMs?: number;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** 
   * Provider preference (default: 'coinbase' for consistency)
   * - 'coinbase': Lower frequency (1-5/sec), smoother, RECOMMENDED for game consistency
   * - 'binance': High frequency (50-200+/sec), spiky - NOT recommended
   * - 'auto': Coinbase first, Binance as fallback
   */
  provider?: 'binance' | 'coinbase' | 'auto';
}

type Provider = 'binance' | 'coinbase';

const PROVIDERS: Record<Provider, { url: string; parsePrice: (data: unknown) => number | null }> = {
  binance: {
    url: 'wss://stream.binance.com:9443/ws/solusdt@trade',
    parsePrice: (data: unknown) => {
      const d = data as { p?: string };
      return d.p ? parseFloat(d.p) : null;
    },
  },
  coinbase: {
    url: 'wss://ws-feed.exchange.coinbase.com',
    parsePrice: (data: unknown) => {
      const d = data as { type?: string; price?: string };
      return d.type === 'ticker' && d.price ? parseFloat(d.price) : null;
    },
  },
};

// NORMALIZED OUTPUT: Fixed update interval for consistent game experience
const NORMALIZED_OUTPUT_INTERVAL_MS = 100; // 10 updates per second max

/**
 * Hook to get real-time Solana price from WebSocket
 * 
 * NORMALIZED FOR CONSISTENCY:
 * - Uses Coinbase by default (1-5 updates/sec, smooth)
 * - Falls back to Binance only on connection failure
 * - Applies smoothing to normalize any provider differences
 * - Outputs at fixed intervals regardless of input frequency
 */
export function useSolanaPrice(options: UseSolanaPriceOptions = {}) {
  // CONSISTENCY: Default to Coinbase for uniform experience across all clients
  const { 
    updateIntervalMs = NORMALIZED_OUTPUT_INTERVAL_MS, 
    autoReconnect = true, 
    provider = 'coinbase'  // Changed from 'auto' to 'coinbase' for consistency
  } = options;
  
  const [price, setPrice] = useState<number | null>(null);
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const providerIndexRef = useRef(0);
  
  // PRICE NORMALIZATION: Collect raw prices and output smoothed values at fixed intervals
  const rawPricesRef = useRef<number[]>([]);
  const lastOutputTimeRef = useRef<number>(0);
  const smoothedPriceRef = useRef<number | null>(null);
  const outputIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Provider selection: Coinbase first (for consistency), Binance as fallback
  const getNextProvider = useCallback((): Provider => {
    if (provider !== 'auto') return provider;
    // CONSISTENCY: Always try Coinbase first, Binance only as fallback
    const providers: Provider[] = ['coinbase', 'binance'];
    const current = providers[providerIndexRef.current % providers.length];
    providerIndexRef.current++;
    return current;
  }, [provider]);

  // Process raw prices and output normalized values
  const processAndOutputPrice = useCallback(() => {
    const rawPrices = rawPricesRef.current;
    if (rawPrices.length === 0) return;
    
    // NORMALIZATION: Use the latest price (most recent)
    // For spiky feeds like Binance, we take the last value in the batch
    // For smooth feeds like Coinbase, this is usually just 1 value
    const latestPrice = rawPrices[rawPrices.length - 1];
    
    // Apply exponential smoothing for consistent output
    // This dampens any remaining spikiness from high-frequency feeds
    const SMOOTHING_FACTOR = 0.3; // Lower = smoother, higher = more responsive
    
    if (smoothedPriceRef.current === null) {
      smoothedPriceRef.current = latestPrice;
    } else {
      smoothedPriceRef.current = smoothedPriceRef.current + 
        SMOOTHING_FACTOR * (latestPrice - smoothedPriceRef.current);
    }
    
    // Clear the raw prices buffer
    rawPricesRef.current = [];
    
    // Output the smoothed price
    const outputPrice = smoothedPriceRef.current;
    
    setPrice(currentPrice => {
      if (currentPrice !== null && currentPrice !== outputPrice) {
        setPreviousPrice(currentPrice);
      }
      return outputPrice;
    });
    
    lastOutputTimeRef.current = Date.now();
  }, []);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const currentProvider = getNextProvider();
    const config = PROVIDERS[currentProvider];
    
    console.log(`[SolanaPrice] Connecting to ${currentProvider}...`);
    
    try {
      const ws = new WebSocket(config.url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[SolanaPrice] Connected to ${currentProvider}`);
        setIsConnected(true);
        setError(null);
        setActiveProvider(currentProvider);
        reconnectAttemptsRef.current = 0;

        // Coinbase requires subscription message
        if (currentProvider === 'coinbase') {
          ws.send(JSON.stringify({
            type: 'subscribe',
            product_ids: ['SOL-USD'],
            channels: ['ticker']
          }));
        }
        
        // Start the normalized output interval
        if (outputIntervalRef.current) {
          clearInterval(outputIntervalRef.current);
        }
        outputIntervalRef.current = setInterval(processAndOutputPrice, updateIntervalMs);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const newPrice = config.parsePrice(data);
          
          if (newPrice !== null && !isNaN(newPrice)) {
            // NORMALIZATION: Collect raw prices, don't output directly
            // This batches high-frequency updates and smooths them
            rawPricesRef.current.push(newPrice);
            
            // Limit buffer size to prevent memory issues on very high frequency feeds
            if (rawPricesRef.current.length > 100) {
              rawPricesRef.current = rawPricesRef.current.slice(-50);
            }
          }
        } catch {
          // Ignore parse errors for non-price messages
        }
      };

      ws.onerror = () => {
        console.warn(`[SolanaPrice] Connection error on ${currentProvider}`);
        setError(`Connection error on ${currentProvider}`);
      };

      ws.onclose = (event) => {
        console.log(`[SolanaPrice] Disconnected from ${currentProvider}:`, event.code);
        setIsConnected(false);
        wsRef.current = null;
        
        // Clear the output interval
        if (outputIntervalRef.current) {
          clearInterval(outputIntervalRef.current);
          outputIntervalRef.current = null;
        }

        // Auto-reconnect with exponential backoff
        if (autoReconnect && reconnectAttemptsRef.current < 15) {
          const delay = Math.min(1000 * Math.pow(1.5, reconnectAttemptsRef.current), 30000);
          console.log(`[SolanaPrice] Reconnecting in ${Math.round(delay)}ms...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      };
    } catch (err) {
      console.error('[SolanaPrice] Failed to create WebSocket:', err);
      setError('Failed to connect to price feed');
      
      // Try reconnecting with different provider
      if (autoReconnect) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connect();
        }, 2000);
      }
    }
  }, [updateIntervalMs, autoReconnect, getNextProvider, processAndOutputPrice]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (outputIntervalRef.current) {
      clearInterval(outputIntervalRef.current);
      outputIntervalRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setActiveProvider(null);
  }, []);

  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Calculate price direction
  const priceDirection = price !== null && previousPrice !== null
    ? price > previousPrice ? 'up' : price < previousPrice ? 'down' : 'neutral'
    : 'neutral';

  return {
    price,
    previousPrice,
    priceDirection,
    isConnected,
    error,
    activeProvider,
    reconnect: connect,
    disconnect,
  };
}
