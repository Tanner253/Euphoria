/**
 * Server-Side Price Feed Service
 * 
 * Single WebSocket connection to price provider.
 * This is the ONLY place prices enter the system.
 */

import WebSocket from 'ws';

type PriceCallback = (price: number) => void;

interface PriceServiceOptions {
  provider?: 'coinbase' | 'binance';
  onPrice: PriceCallback;
}

const PROVIDERS = {
  coinbase: {
    url: 'wss://ws-feed.exchange.coinbase.com',
    subscribe: JSON.stringify({
      type: 'subscribe',
      product_ids: ['SOL-USD'],
      channels: ['ticker']
    }),
    parsePrice: (data: unknown): number | null => {
      const d = data as { type?: string; price?: string };
      return d.type === 'ticker' && d.price ? parseFloat(d.price) : null;
    },
  },
  binance: {
    url: 'wss://stream.binance.com:9443/ws/solusdt@trade',
    subscribe: null,
    parsePrice: (data: unknown): number | null => {
      const d = data as { p?: string };
      return d.p ? parseFloat(d.p) : null;
    },
  },
};

export class PriceService {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private provider: 'coinbase' | 'binance';
  private onPrice: PriceCallback;
  private isConnected = false;
  
  constructor(options: PriceServiceOptions) {
    this.provider = options.provider || 'coinbase';
    this.onPrice = options.onPrice;
  }
  
  start(): void {
    this.connect();
  }
  
  stop(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
  }
  
  private connect(): void {
    const config = PROVIDERS[this.provider];
    
    console.log(`[PriceService] Connecting to ${this.provider}...`);
    
    try {
      this.ws = new WebSocket(config.url);
      
      this.ws.on('open', () => {
        console.log(`[PriceService] Connected to ${this.provider}`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Send subscription message if required
        if (config.subscribe && this.ws) {
          this.ws.send(config.subscribe);
        }
      });
      
      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString());
          const price = config.parsePrice(parsed);
          
          if (price !== null && !isNaN(price)) {
            this.onPrice(price);
          }
        } catch {
          // Ignore parse errors
        }
      });
      
      this.ws.on('close', () => {
        console.log(`[PriceService] Disconnected from ${this.provider}`);
        this.isConnected = false;
        this.ws = null;
        this.scheduleReconnect();
      });
      
      this.ws.on('error', (error) => {
        console.error(`[PriceService] Error:`, error.message);
      });
      
    } catch (error) {
      console.error(`[PriceService] Failed to connect:`, error);
      this.scheduleReconnect();
    }
  }
  
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 15) {
      console.error('[PriceService] Max reconnect attempts reached');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
    console.log(`[PriceService] Reconnecting in ${Math.round(delay)}ms...`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }
  
  getStatus(): { connected: boolean; provider: string } {
    return {
      connected: this.isConnected,
      provider: this.provider,
    };
  }
}

