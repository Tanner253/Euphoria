/**
 * Euphoria Game Server
 * 
 * Authoritative game server with Socket.io for real-time state sync.
 * This is the SINGLE SOURCE OF TRUTH for all game state.
 * 
 * FULL SOCKET ARCHITECTURE:
 * - Game state updates via socket
 * - Bet placement with database integration via socket
 * - Bet resolution with payout via socket
 * - Balance updates pushed via socket
 * - Admin dashboard via socket namespace
 * - Leaderboard via socket
 * - Chat via socket
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env.local from the root app directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';

import { SERVER_CONFIG, getClientConfig } from './config.js';
import { GameEngine, Bet } from './gameEngine.js';
import { PriceService } from './priceService.js';
import { 
  setPlayerOnline, 
  getLeaderboardData,
  createRecentWin
} from './leaderboard.js';
import { connectToDatabase, closeDatabase } from './database.js';
import { createMessage, getRecentMessages, ChatMessage } from './chat.js';
import { 
  UserServiceServer, 
  BetServiceServer, 
  AdminDataService,
  Bet as DbBet 
} from './services.js';

// ============ SERVER SETUP ============

const app = express();
const httpServer = createServer(app);

// CORS for both Express and Socket.io
const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

app.use(express.json());

// Socket.io server
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Performance optimizations
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
});

// ============ GAME ENGINE ============

// Track active bets that need database resolution
const pendingDbBets = new Map<string, { dbBetId: string; walletAddress: string }>();

// Create game engine with bet resolution callback
const gameEngine = new GameEngine(async (bet, won) => {
  // Find the database bet ID for this game bet
  const dbBetInfo = pendingDbBets.get(bet.id);
  
  if (dbBetInfo) {
    try {
      // Resolve bet in database and get updated balance
      const priceAtResolution = gameEngine.getFullState().currentPrice || 0;
      const betService = BetServiceServer.getInstance();
      const result = await betService.resolveBet(dbBetInfo.dbBetId, won, priceAtResolution);
      
      if (result.success && result.newBalance !== undefined) {
        // Send balance update to the player via socket
        for (const [socketId, clientData] of connectedClients.entries()) {
          if (clientData.walletAddress === bet.walletAddress) {
            io.to(socketId).emit('balanceUpdate', { 
              newBalance: result.newBalance,
              reason: won ? `Won ${bet.payout} gems!` : `Lost ${bet.wager} gems`,
              betId: dbBetInfo.dbBetId,
              won,
            });
            io.to(socketId).emit('betResolved', { 
              bet, 
              won,
              dbBetId: dbBetInfo.dbBetId,
              actualWin: won ? bet.payout : 0,
              newBalance: result.newBalance,
            });
          }
        }
      }
      
      // Remove from pending map
      pendingDbBets.delete(bet.id);
    } catch (err) {
      console.error('[Server] Failed to resolve bet in database:', err);
      // Still notify the player
      for (const [socketId, clientData] of connectedClients.entries()) {
        if (clientData.walletAddress === bet.walletAddress) {
          io.to(socketId).emit('betResolved', { bet, won, error: 'Database error' });
        }
      }
    }
  } else {
    // Demo bet (no database entry) - just broadcast result
    for (const [socketId, clientData] of connectedClients.entries()) {
      if (clientData.walletAddress === bet.walletAddress) {
        io.to(socketId).emit('betResolved', { bet, won });
      }
    }
  }
  
  // Broadcast recent win to everyone if it was a win
  if (won) {
    const recentWin = createRecentWin(bet.walletAddress, bet.payout, bet.oddsMultiplier);
    io.emit('recentWin', recentWin);
  }
  
  // Broadcast updated leaderboard to subscribers (async fetch from MongoDB)
  try {
    const leaderboardData = await getLeaderboardData();
    io.to('leaderboard').emit('leaderboard', leaderboardData);
  } catch (err) {
    console.error('[Server] Failed to broadcast leaderboard:', err);
  }
  
  // Broadcast admin update
  broadcastAdminUpdate();
});

// ============ PRICE SERVICE ============

const priceService = new PriceService({
  provider: (process.env.PRICE_PROVIDER as 'coinbase' | 'binance') || 'coinbase',
  onPrice: (price: number) => {
    gameEngine.onPriceUpdate(price);
  },
});

// ============ SOCKET.IO HANDLERS ============

interface ClientData {
  walletAddress?: string;
  isMobile: boolean;
  zoomLevel: number;
  isAdmin?: boolean;
}

const connectedClients = new Map<string, ClientData>();

// ============ ADMIN BROADCASTING ============

let lastAdminBroadcast = Date.now();
const ADMIN_BROADCAST_INTERVAL = 2000; // Broadcast admin updates every 2 seconds max

async function broadcastAdminUpdate() {
  const now = Date.now();
  // Throttle admin broadcasts
  if (now - lastAdminBroadcast < ADMIN_BROADCAST_INTERVAL) {
    return;
  }
  lastAdminBroadcast = now;
  
  try {
    const adminData = await AdminDataService.getDashboardData();
    io.to('admin').emit('adminData', adminData);
  } catch (err) {
    console.error('[Server] Failed to broadcast admin data:', err);
  }
}

io.on('connection', (socket: Socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  
  // Initialize client data
  connectedClients.set(socket.id, {
    isMobile: false,
    zoomLevel: 1.0,
  });
  
  // Send server config to client (single source of truth)
  socket.emit('serverConfig', getClientConfig());
  
  // Send initial state immediately
  socket.emit('gameState', gameEngine.getCompactState());
  
  // Send initial leaderboard (async)
  getLeaderboardData().then(data => {
    socket.emit('leaderboard', data);
  }).catch(err => {
    console.error('[Socket] Failed to send initial leaderboard:', err);
  });
  
  // Client identifies themselves
  socket.on('identify', async (data: { walletAddress?: string; isMobile?: boolean; zoomLevel?: number }) => {
    const clientData = connectedClients.get(socket.id);
    if (clientData) {
      // Mark previous wallet as offline if changed
      if (clientData.walletAddress && clientData.walletAddress !== data.walletAddress) {
        setPlayerOnline(clientData.walletAddress, false);
      }
      
      clientData.walletAddress = data.walletAddress;
      clientData.isMobile = data.isMobile || false;
      clientData.zoomLevel = data.zoomLevel || 1.0;
      
      // Mark new wallet as online and broadcast updated leaderboard
      if (data.walletAddress) {
        setPlayerOnline(data.walletAddress, true);
        
        // Fetch and send user data (balance, stats) to the identified client
        try {
          const userService = UserServiceServer.getInstance();
          const user = await userService.getUser(data.walletAddress);
          if (user) {
            socket.emit('userData', {
              walletAddress: user.walletAddress,
              gemsBalance: user.gemsBalance,
              totalBets: user.totalBets,
              totalWins: user.totalWins,
              totalLosses: user.totalLosses,
              status: user.status,
            });
          }
        } catch (err) {
          console.error('[Socket] Failed to fetch user data:', err);
        }
        
        // Broadcast updated leaderboard (player came online)
        getLeaderboardData().then(leaderboard => {
          io.to('leaderboard').emit('leaderboard', leaderboard);
        });
      }
    }
    console.log(`[Socket] Client identified: ${socket.id} - wallet: ${data.walletAddress || 'anonymous'}`);
  });
  
  // Client requests their user data (balance, stats)
  socket.on('getUserData', async (callback: (response: { success: boolean; user?: unknown; error?: string }) => void) => {
    const clientData = connectedClients.get(socket.id);
    
    if (!clientData?.walletAddress) {
      callback({ success: false, error: 'Not authenticated' });
      return;
    }
    
    try {
      const userService = UserServiceServer.getInstance();
      const user = await userService.getUser(clientData.walletAddress);
      
      if (user) {
        callback({
          success: true,
          user: {
            walletAddress: user.walletAddress,
            gemsBalance: user.gemsBalance,
            totalBets: user.totalBets,
            totalWins: user.totalWins,
            totalLosses: user.totalLosses,
            status: user.status,
          },
        });
      } else {
        callback({ success: false, error: 'User not found' });
      }
    } catch (err) {
      callback({ success: false, error: 'Database error' });
    }
  });
  
  // Client updates their zoom level
  socket.on('setZoom', (zoomLevel: number) => {
    const clientData = connectedClients.get(socket.id);
    if (clientData) {
      clientData.zoomLevel = zoomLevel;
    }
  });
  
  // Client places a bet (with full database integration)
  socket.on('placeBet', async (betData: {
    colId: string;
    yIndex: number;
    wager: number;
    oddsIndex: number;
    oddsMultiplier: string;
    sessionId?: string;
    basePrice?: number;
    cellSize?: number;
    clientOffsetX?: number; // Client's world offset for sync
    useDatabase?: boolean; // If false, demo mode (no database)
  }, callback: (response: { success: boolean; bet?: Bet; error?: string; newBalance?: number; dbBetId?: string }) => void) => {
    const clientData = connectedClients.get(socket.id);
    
    if (!clientData?.walletAddress) {
      callback({ success: false, error: 'Not authenticated' });
      return;
    }
    
    const multiplier = parseFloat(betData.oddsMultiplier);
    const payout = betData.wager * multiplier;
    const gameState = gameEngine.getFullState();
    const currentPrice = gameState.currentPrice || 0;
    
    // Sync server offsetX with client if they're ahead
    if (betData.clientOffsetX !== undefined && betData.clientOffsetX > gameState.offsetX) {
      gameEngine.syncOffsetX(betData.clientOffsetX);
    }
    
    // If useDatabase is true (default for authenticated users), validate and record in database
    if (betData.useDatabase !== false) {
      try {
        const betService = BetServiceServer.getInstance();
        
        // Calculate win price boundaries (grid-aligned)
        const cellSize = betData.cellSize || SERVER_CONFIG.CELL_SIZE;
        const basePrice = betData.basePrice || currentPrice;
        
        const cellYTop = betData.yIndex * cellSize;
        const cellYBottom = (betData.yIndex + 1) * cellSize;
        const winPriceMax = basePrice + (cellSize / 2 - cellYTop) / SERVER_CONFIG.PRICE_SCALE;
        const winPriceMin = basePrice + (cellSize / 2 - cellYBottom) / SERVER_CONFIG.PRICE_SCALE;
        
        // Place bet in database (validates balance and deducts gems)
        const dbResult = await betService.placeBet({
          walletAddress: clientData.walletAddress,
          sessionId: betData.sessionId || `session_${socket.id}`,
          amount: betData.wager,
          multiplier,
          columnId: betData.colId,
          yIndex: betData.yIndex,
          basePrice,
          cellSize,
          priceAtBet: currentPrice,
          winPriceMin,
          winPriceMax,
        });
        
        if (!dbResult.success) {
          // Send current balance back to client if balance issue
          if (dbResult.newBalance !== undefined) {
            socket.emit('balanceUpdate', { 
              newBalance: dbResult.newBalance,
              reason: dbResult.error || 'Bet failed',
            });
          }
          callback({ success: false, error: dbResult.error, newBalance: dbResult.newBalance });
          return;
        }
        
        // Now place in game engine for visual tracking
        const gameBetId = `bet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const bet = gameEngine.placeBet({
          id: gameBetId,
          colId: betData.colId,
          yIndex: betData.yIndex,
          wager: betData.wager,
          oddsIndex: betData.oddsIndex,
          oddsMultiplier: betData.oddsMultiplier,
          payout,
          walletAddress: clientData.walletAddress,
        });
        
        if (bet) {
          // Track the mapping between game bet ID and database bet ID
          pendingDbBets.set(gameBetId, {
            dbBetId: dbResult.bet!._id!.toString(),
            walletAddress: clientData.walletAddress,
          });
          
          // Send balance update to client
          if (dbResult.newBalance !== undefined) {
            socket.emit('balanceUpdate', { 
              newBalance: dbResult.newBalance,
              reason: `Bet placed: ${betData.wager} gems`,
            });
          }
          
          // Broadcast bet to all clients so they can see it on the grid
          io.emit('betPlaced', bet);
          callback({ 
            success: true, 
            bet, 
            newBalance: dbResult.newBalance,
            dbBetId: dbResult.bet!._id!.toString(),
          });
          
          // Trigger admin update
          broadcastAdminUpdate();
        } else {
          // Game engine rejected bet (too close, etc.) - refund in database
          const userService = UserServiceServer.getInstance();
          await userService.updateBalance(
            clientData.walletAddress,
            betData.wager,
            'Bet refunded: Invalid placement position'
          );
          const user = await userService.getUser(clientData.walletAddress);
          
          callback({ success: false, error: 'Invalid bet placement - refunded', newBalance: user?.gemsBalance });
        }
      } catch (err) {
        console.error('[Server] Database bet error:', err);
        callback({ success: false, error: 'Database error' });
      }
    } else {
      // Demo mode - no database, just game engine
      const bet = gameEngine.placeBet({
        id: `bet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        colId: betData.colId,
        yIndex: betData.yIndex,
        wager: betData.wager,
        oddsIndex: betData.oddsIndex,
        oddsMultiplier: betData.oddsMultiplier,
        payout,
        walletAddress: clientData.walletAddress,
      });
      
      if (bet) {
        io.emit('betPlaced', bet);
        callback({ success: true, bet });
      } else {
        callback({ success: false, error: 'Invalid bet placement' });
      }
    }
  });
  
  // Client places multiple bets (drag mode batch)
  socket.on('placeBetBatch', async (
    batchData: {
      sessionId: string;
      clientOffsetX?: number;
      bets: Array<{
        colId: string;
        yIndex: number;
        wager: number;
        oddsIndex: number;
        oddsMultiplier: string;
        basePrice?: number;
        cellSize?: number;
      }>;
    },
    callback: (response: { 
      success: boolean; 
      results: Array<{ index: number; success: boolean; betId?: string; error?: string }>;
      newBalance?: number;
      error?: string;
    }) => void
  ) => {
    const clientData = connectedClients.get(socket.id);
    
    // Sync offsetX with client
    if (batchData.clientOffsetX !== undefined) {
      gameEngine.syncOffsetX(batchData.clientOffsetX);
    }
    
    if (!clientData) {
      callback({ success: false, results: [], error: 'Not connected' });
      return;
    }
    
    const results: Array<{ index: number; success: boolean; betId?: string; gameBetId?: string; error?: string }> = [];
    const betsToAddToEngine: Array<{ index: number; gameBetId: string; betData: typeof batchData.bets[0]; dbBetId?: string }> = [];
    
    // Authenticated user - batch place in database first
    if (clientData.walletAddress) {
      try {
        const betService = BetServiceServer.getInstance();
        const userService = UserServiceServer.getInstance();
        const state = gameEngine.getFullState();
        const basePrice = state.currentPrice || 0;
        const cellSize = clientData.zoomLevel ? Math.floor(60 * clientData.zoomLevel) : 60;
        
        // Validate total amount
        const totalAmount = batchData.bets.reduce((sum, b) => sum + b.wager, 0);
        const user = await userService.getUser(clientData.walletAddress);
        
        if (!user || user.gemsBalance < totalAmount) {
          callback({ 
            success: false, 
            results: [], 
            error: 'Insufficient balance',
            newBalance: user?.gemsBalance 
          });
          return;
        }
        
        // Process each bet
        let newBalance = user.gemsBalance;
        
        for (let i = 0; i < batchData.bets.length; i++) {
          const betData = batchData.bets[i];
          const multiplier = parseFloat(betData.oddsMultiplier) || 1.5;
          const payout = betData.wager * multiplier;
          
          // Calculate win boundaries
          const betCellSize = betData.cellSize || cellSize;
          const betBasePrice = betData.basePrice || basePrice;
          const cellYTop = betData.yIndex * betCellSize;
          const cellYBottom = (betData.yIndex + 1) * betCellSize;
          const winPriceMax = betBasePrice + (betCellSize / 2 - cellYTop) / SERVER_CONFIG.PRICE_SCALE;
          const winPriceMin = betBasePrice + (betCellSize / 2 - cellYBottom) / SERVER_CONFIG.PRICE_SCALE;
          
          // Place in database
          const dbResult = await betService.placeBet({
            walletAddress: clientData.walletAddress,
            sessionId: batchData.sessionId || `session_${socket.id}`,
            amount: betData.wager,
            multiplier,
            columnId: betData.colId,
            yIndex: betData.yIndex,
            basePrice: betBasePrice,
            cellSize: betCellSize,
            priceAtBet: betBasePrice,
            winPriceMin,
            winPriceMax,
          });
          
          if (dbResult.success && dbResult.bet?._id) {
            newBalance = dbResult.newBalance ?? newBalance - betData.wager;
            const gameBetId = `bet_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
            
            results.push({ 
              index: i, 
              success: true, 
              betId: dbResult.bet._id.toString(),
              gameBetId,
            });
            
            betsToAddToEngine.push({
              index: i,
              gameBetId,
              betData,
              dbBetId: dbResult.bet._id.toString(),
            });
          } else {
            results.push({ 
              index: i, 
              success: false, 
              error: dbResult.error || 'Failed to place bet',
            });
          }
        }
        
        // Add all successful bets to game engine
        for (const betInfo of betsToAddToEngine) {
          const betData = betInfo.betData;
          const multiplier = parseFloat(betData.oddsMultiplier) || 1.5;
          const payout = betData.wager * multiplier;
          
          const bet = gameEngine.placeBet({
            id: betInfo.gameBetId,
            colId: betData.colId,
            yIndex: betData.yIndex,
            wager: betData.wager,
            oddsIndex: betData.oddsIndex,
            oddsMultiplier: betData.oddsMultiplier,
            payout,
            walletAddress: clientData.walletAddress,
          });
          
          if (bet && betInfo.dbBetId) {
            pendingDbBets.set(betInfo.gameBetId, {
              dbBetId: betInfo.dbBetId,
              walletAddress: clientData.walletAddress,
            });
            io.emit('betPlaced', bet);
          }
        }
        
        callback({ 
          success: true, 
          results,
          newBalance,
        });
        
      } catch (err) {
        console.error('[Server] Batch bet error:', err);
        callback({ success: false, results: [], error: 'Database error' });
      }
    } else {
      // Demo mode - just add to game engine
      for (let i = 0; i < batchData.bets.length; i++) {
        const betData = batchData.bets[i];
        const multiplier = parseFloat(betData.oddsMultiplier) || 1.5;
        const payout = betData.wager * multiplier;
        const gameBetId = `bet_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
        
        const bet = gameEngine.placeBet({
          id: gameBetId,
          colId: betData.colId,
          yIndex: betData.yIndex,
          wager: betData.wager,
          oddsIndex: betData.oddsIndex,
          oddsMultiplier: betData.oddsMultiplier,
          payout,
          walletAddress: 'demo',
        });
        
        if (bet) {
          io.emit('betPlaced', bet);
          results.push({ index: i, success: true, betId: gameBetId });
        } else {
          results.push({ index: i, success: false, error: 'Invalid placement' });
        }
      }
      
      callback({ success: true, results });
    }
  });
  
  // Client requests full state (reconnection)
  socket.on('requestState', () => {
    socket.emit('gameState', gameEngine.getCompactState());
  });
  
  // Subscribe to leaderboard updates
  socket.on('subscribeLeaderboard', async () => {
    socket.join('leaderboard');
    try {
      const data = await getLeaderboardData();
      socket.emit('leaderboard', data);
    } catch (err) {
      console.error('[Socket] Failed to send leaderboard on subscribe:', err);
    }
  });
  
  // Unsubscribe from leaderboard
  socket.on('unsubscribeLeaderboard', () => {
    socket.leave('leaderboard');
  });
  
  // ==================== GLOBAL CHAT ====================
  
  // Subscribe to chat
  socket.on('subscribeChat', () => {
    socket.join('chat');
    // Send recent messages
    socket.emit('chatHistory', getRecentMessages(50));
  });
  
  // Unsubscribe from chat
  socket.on('unsubscribeChat', () => {
    socket.leave('chat');
  });
  
  // Send a chat message
  socket.on('sendChatMessage', (
    message: string, 
    callback: (response: { success: boolean; error?: string }) => void
  ) => {
    const clientData = connectedClients.get(socket.id);
    
    if (!clientData?.walletAddress) {
      callback({ success: false, error: 'Connect wallet to chat' });
      return;
    }
    
    const result = createMessage(clientData.walletAddress, message);
    
    if (result.success && result.message) {
      // Broadcast to all chat subscribers
      io.to('chat').emit('newChatMessage', result.message);
      callback({ success: true });
    } else {
      callback({ success: false, error: result.error });
    }
  });
  
  // ==================== END CHAT ====================
  
  // ==================== ADMIN SUBSCRIPTION ====================
  
  // Subscribe to admin updates (development only)
  socket.on('subscribeAdmin', async (callback?: (response: { success: boolean; data?: unknown; error?: string }) => void) => {
    // In production, you'd want to verify admin status here
    const isDev = process.env.NODE_ENV === 'development';
    
    if (!isDev) {
      callback?.({ success: false, error: 'Admin panel not available in production' });
      return;
    }
    
    const clientData = connectedClients.get(socket.id);
    if (clientData) {
      clientData.isAdmin = true;
    }
    
    socket.join('admin');
    console.log(`[Socket] Admin subscribed: ${socket.id}`);
    
    // Send initial admin data
    try {
      const adminData = await AdminDataService.getDashboardData();
      callback?.({ success: true, data: adminData });
      socket.emit('adminData', adminData);
    } catch (err) {
      console.error('[Socket] Failed to send admin data:', err);
      callback?.({ success: false, error: 'Failed to fetch admin data' });
    }
  });
  
  // Unsubscribe from admin
  socket.on('unsubscribeAdmin', () => {
    socket.leave('admin');
    const clientData = connectedClients.get(socket.id);
    if (clientData) {
      clientData.isAdmin = false;
    }
  });
  
  // Admin action request
  socket.on('adminAction', async (
    action: { type: string; payload?: Record<string, unknown> },
    callback: (response: { success: boolean; result?: unknown; error?: string }) => void
  ) => {
    const isDev = process.env.NODE_ENV === 'development';
    
    if (!isDev) {
      callback({ success: false, error: 'Admin panel not available in production' });
      return;
    }
    
    console.log(`[Socket] Admin action: ${action.type}`);
    
    // Actions will be handled similarly to the REST API
    // For now, just acknowledge and trigger data refresh
    try {
      // Broadcast updated admin data to all admin subscribers
      const adminData = await AdminDataService.getDashboardData();
      io.to('admin').emit('adminData', adminData);
      callback({ success: true, result: { message: 'Action processed' } });
    } catch (err) {
      callback({ success: false, error: 'Failed to process action' });
    }
  });
  
  // ==================== END ADMIN ====================
  
  // Ping for latency measurement
  socket.on('ping', (timestamp: number) => {
    socket.emit('pong', { sent: timestamp, server: Date.now() });
  });
  
  socket.on('disconnect', (reason) => {
    // Mark player as offline
    const clientData = connectedClients.get(socket.id);
    if (clientData?.walletAddress) {
      setPlayerOnline(clientData.walletAddress, false);
      
      // Broadcast updated leaderboard (player went offline)
      getLeaderboardData().then(leaderboard => {
        io.to('leaderboard').emit('leaderboard', leaderboard);
      });
    }
    
    console.log(`[Socket] Client disconnected: ${socket.id} - ${reason}`);
    connectedClients.delete(socket.id);
  });
  
  socket.on('error', (error) => {
    console.error(`[Socket] Error from ${socket.id}:`, error);
  });
});

// ============ GAME LOOP ============

let lastBroadcast = Date.now();
let lastLeaderboardBroadcast = Date.now();
const BROADCAST_INTERVAL = SERVER_CONFIG.TICK_MS; // ~16.67ms for 60fps
const LEADERBOARD_BROADCAST_INTERVAL = 5000; // 5 seconds

function gameLoop(): void {
  // Tick the game engine
  gameEngine.tick();
  
  const now = Date.now();
  
  // Broadcast game state at target rate
  if (now - lastBroadcast >= BROADCAST_INTERVAL) {
    const state = gameEngine.getCompactState();
    io.emit('gameState', state);
    lastBroadcast = now;
  }
  
  // Broadcast leaderboard periodically to all subscribers
  if (now - lastLeaderboardBroadcast >= LEADERBOARD_BROADCAST_INTERVAL) {
    getLeaderboardData().then(data => {
      io.to('leaderboard').emit('leaderboard', data);
    }).catch(() => {});
    lastLeaderboardBroadcast = now;
  }
}

// Run game loop at higher frequency for smooth physics
const PHYSICS_INTERVAL = 8; // ~120fps physics, 60fps broadcast
let gameLoopInterval: NodeJS.Timeout;

function startGameLoop(): void {
  gameLoopInterval = setInterval(gameLoop, PHYSICS_INTERVAL);
  console.log(`[GameLoop] Started at ${Math.round(1000 / PHYSICS_INTERVAL)}fps physics, ${Math.round(1000 / BROADCAST_INTERVAL)}fps broadcast`);
}

// ============ HTTP ENDPOINTS ============

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    clients: connectedClients.size,
    price: priceService.getStatus(),
  });
});

// Get server config (for client sync)
app.get('/config', (req, res) => {
  res.json(getClientConfig());
});

// Get leaderboard (REST endpoint)
app.get('/leaderboard', async (req, res) => {
  try {
    const data = await getLeaderboardData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Player stats are sent via socket - no REST endpoint needed

// ============ START SERVER ============

const PORT = SERVER_CONFIG.PORT;

httpServer.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      EUPHORIA GAME SERVER                ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Port: ${PORT}                              ║`);
  console.log(`║  CORS: ${corsOrigins[0].substring(0, 30).padEnd(30)} ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  
  // Start services
  priceService.start();
  startGameLoop();
  
  console.log('[Server] Ready to accept connections');
});

// Graceful shutdown
async function shutdown() {
  console.log('[Server] Shutting down...');
  clearInterval(gameLoopInterval);
  priceService.stop();
  io.close();
  await closeDatabase();
  httpServer.close(() => {
    console.log('[Server] Closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

