/**
 * Game API Client
 * 
 * Client-side service for interacting with server-authoritative game APIs
 * All balance changes happen through these APIs - never locally
 */

interface PlaceBetParams {
  sessionId: string;
  columnId: string;
  yIndex: number;
  basePrice: number;  // Client's basePrice - anchor for grid coordinates
  cellSize: number;   // Effective cell size (with zoom applied)
  amount: number;
  multiplier: number;
}

interface PlaceBetResponse {
  success: boolean;
  error?: string;
  bet?: {
    id: string;
    amount: number;
    multiplier: number;
    potentialWin: number;
    priceAtBet: number;
    // Server-calculated win boundaries (for visualization only)
    winPriceMin?: number;
    winPriceMax?: number;
    status: string;
  };
  newBalance?: number;
  balance?: number;  // Actual server balance (returned on failure)
}

interface ResolveBetResponse {
  success: boolean;
  error?: string;
  bet?: {
    id: string;
    status: 'won' | 'lost' | 'pending';
    amount: number;
    multiplier: number;
    potentialWin: number;
    actualWin: number;
    priceAtBet: number;
    priceAtResolution?: number;
  };
  isWin?: boolean;
  alreadyResolved?: boolean;
}

interface UserBalanceResponse {
  user: {
    walletAddress: string;
    gemsBalance: number;
    status: string;
  };
  stats?: {
    totalBets: number;
    winRate: number;
    totalWagered: number;
    netProfit: number;
  };
}

class GameAPIService {
  private token: string | null = null;
  
  /**
   * Set the auth token for API calls
   */
  setToken(token: string | null) {
    this.token = token;
  }
  
  /**
   * Get auth headers
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    return headers;
  }
  
  /**
   * Get user balance from server
   */
  async getBalance(): Promise<UserBalanceResponse | null> {
    if (!this.token) return null;
    
    try {
      const response = await fetch('/api/user/me', {
        headers: this.getHeaders(),
      });
      
      if (!response.ok) return null;
      
      return await response.json();
    } catch {
      return null;
    }
  }
  
  /**
   * Place a bet (server-authoritative)
   */
  async placeBet(params: PlaceBetParams): Promise<PlaceBetResponse> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }
    
    try {
      const response = await fetch('/api/bets/place', {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(params),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        // Include actual server balance if provided (for insufficient balance errors)
        return { 
          success: false, 
          error: data.error || 'Failed to place bet',
          balance: data.balance  // Server's authoritative balance
        };
      }
      
      return data;
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }
  
  /**
   * Resolve a bet (server-authoritative)
   * Server validates crossing price range for "touch" win detection
   */
  async resolveBet(
    betId: string, 
    clientHint?: boolean, 
    priceAtCrossing?: number,
    priceRangeMin?: number,
    priceRangeMax?: number
  ): Promise<ResolveBetResponse> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }
    
    try {
      const response = await fetch('/api/bets/resolve', {
        method: 'POST',
        headers: this.getHeaders(),
        // Send the price RANGE the line traveled through for "touch" detection
        body: JSON.stringify({ betId, clientHint, priceAtCrossing, priceRangeMin, priceRangeMax }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        return { success: false, error: data.error || 'Failed to resolve bet' };
      }
      
      return data;
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }
  
  /**
   * Get bet status
   */
  async getBetStatus(betId: string): Promise<ResolveBetResponse> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }
    
    try {
      const response = await fetch(`/api/bets/resolve?betId=${betId}`, {
        headers: this.getHeaders(),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        return { success: false, error: data.error };
      }
      
      return { success: true, bet: data.bet };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  }
  
  /**
   * Place multiple bets in a single request (for drag mode)
   * Reduces HTTP overhead by ~90%
   */
  async placeBetBatch(params: {
    sessionId: string;
    bets: Array<{
      columnId: string;
      yIndex: number;
      basePrice: number;
      cellSize: number;
      amount: number;
      multiplier: number;
    }>;
  }): Promise<PlaceBetBatchResponse> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated', results: [], newBalance: 0 };
    }
    
    try {
      const response = await fetch('/api/bets/place-batch', {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(params),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        return { 
          success: false, 
          error: data.error || 'Failed to place bets',
          results: [],
          newBalance: data.balance ?? 0,
        };
      }
      
      return data;
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error',
        results: [],
        newBalance: 0,
      };
    }
  }
}

interface PlaceBetBatchResponse {
  success: boolean;
  error?: string;
  results: Array<{
    index: number;
    success: boolean;
    betId?: string;
    winPriceMin?: number;
    winPriceMax?: number;
    error?: string;
  }>;
  summary?: {
    total: number;
    successful: number;
    failed: number;
    totalDeducted: number;
  };
  newBalance: number;
}

// Singleton instance
export const gameAPI = new GameAPIService();

// Export types
export type { 
  PlaceBetParams, 
  PlaceBetResponse, 
  PlaceBetBatchResponse,
  ResolveBetResponse, 
  UserBalanceResponse 
};

