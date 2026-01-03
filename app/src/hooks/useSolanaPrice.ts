'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface PriceUpdate {
  price: number;
  timestamp: number;
}

interface UseSolanaPriceOptions {
  /** Update interval in ms for throttling (default: 100ms) */
  throttleMs?: number;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Preferred provider: 'binance' | 'coinbase' (default: tries both) */
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

/**
 * Hook to get real-time Solana price from WebSocket
 * Automatically falls back between providers if one fails
 */
export function useSolanaPrice(options: UseSolanaPriceOptions = {}) {
  const { throttleMs = 100, autoReconnect = true, provider = 'auto' } = options;
  
  const [price, setPrice] = useState<number | null>(null);
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const providerIndexRef = useRef(0);

  const getNextProvider = useCallback((): Provider => {
    if (provider !== 'auto') return provider;
    const providers: Provider[] = ['binance', 'coinbase'];
    const current = providers[providerIndexRef.current % providers.length];
    providerIndexRef.current++;
    return current;
  }, [provider]);

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
      };

      ws.onmessage = (event) => {
        const now = Date.now();
        
        // Throttle updates
        if (now - lastUpdateRef.current < throttleMs) {
          return;
        }
        lastUpdateRef.current = now;

        try {
          const data = JSON.parse(event.data);
          const newPrice = config.parsePrice(data);
          
          if (newPrice !== null && !isNaN(newPrice)) {
            setPrice(currentPrice => {
              if (currentPrice !== null) {
                setPreviousPrice(currentPrice);
              }
              return newPrice;
            });
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
    } catch {
      console.error('[SolanaPrice] Failed to create WebSocket:', e);
      setError('Failed to connect to price feed');
      
      // Try reconnecting with different provider
      if (autoReconnect) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connect();
        }, 2000);
      }
    }
  }, [throttleMs, autoReconnect, getNextProvider]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
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
