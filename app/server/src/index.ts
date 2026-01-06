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
import { MultiGridGameEngine, Bet } from './gameEngine.js';
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

// ============ MULTI-GRID GAME ENGINE ============

// Track active bets that need database resolution
// Key: game bet ID, Value: { dbBetId, walletAddress, zoomLevel }
const pendingDbBets = new Map<string, { dbBetId: string; walletAddress: string; zoomLevel: number }>();

// Create multi-grid game engine (3 grids, one per zoom level)
// Each grid is independent with its own coordinate system
const gameEngine = new MultiGridGameEngine(async (bet, won, zoomLevel) => {
  console.log(`[Server] Bet resolved on grid ${zoomLevel}x: ${bet.id} - ${won ? 'WON' : 'LOST'}`);
  
  // Find the database bet ID for this game bet
  const dbBetInfo = pendingDbBets.get(bet.id);
  
  if (dbBetInfo) {
    try {
      // Resolve bet in database and get updated balance
      const priceAtResolution = gameEngine.getFullState(zoomLevel).currentPrice || 0;
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
              zoomLevel,
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
          io.to(socketId).emit('betResolved', { bet, won, error: 'Database error', zoomLevel });
        }
      }
    }
  } else {
    // Demo bet (no database entry) - just broadcast result
    for (const [socketId, clientData] of connectedClients.entries()) {
      if (clientData.walletAddress === bet.walletAddress) {
        io.to(socketId).emit('betResolved', { bet, won, zoomLevel });
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
  zoomLevel: number;  // Server-authoritative zoom level for this client
  cellSize: number;   // Calculated from zoomLevel - used for ALL bet calculations
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
  
  // Initialize client data with default zoom
  const defaultZoom = SERVER_CONFIG.ZOOM_LEVELS[0]; // Default to first zoom level (2.0x)
  const defaultCellSize = Math.floor(SERVER_CONFIG.CELL_SIZE * defaultZoom);
  connectedClients.set(socket.id, {
    isMobile: false,
    zoomLevel: defaultZoom,
    cellSize: defaultCellSize,
  });
  
  // Send server config to client (single source of truth)
  socket.emit('serverConfig', getClientConfig());
  
  // Send initial state for client's zoom level grid
  socket.emit('gameState', gameEngine.getCompactState(defaultZoom));
  
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
      
      const isMobile = data.isMobile || false;
      const zoomLevel = data.zoomLevel || 1.0;
      const baseCellSize = isMobile ? SERVER_CONFIG.CELL_SIZE_MOBILE : SERVER_CONFIG.CELL_SIZE;
      
      clientData.walletAddress = data.walletAddress;
      clientData.isMobile = isMobile;
      clientData.zoomLevel = zoomLevel;
      clientData.cellSize = Math.floor(baseCellSize * zoomLevel);  // SERVER calculates
      
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
  
  // Client updates their zoom level - switch to that zoom's grid
  socket.on('setZoom', (data: { zoomLevel: number; isMobile?: boolean }) => {
    const clientData = connectedClients.get(socket.id);
    if (clientData) {
      const zoomLevel = data.zoomLevel;
      const isMobile = data.isMobile ?? clientData.isMobile;
      const baseCellSize = isMobile ? SERVER_CONFIG.CELL_SIZE_MOBILE : SERVER_CONFIG.CELL_SIZE;
      
      clientData.zoomLevel = zoomLevel;
      clientData.isMobile = isMobile;
      clientData.cellSize = Math.floor(baseCellSize * zoomLevel);
      
      console.log(`[Socket] Client ${socket.id} switched to grid ${zoomLevel}x, cellSize: ${clientData.cellSize}`);
      
      // Send the new grid's state immediately so client can render correctly
      socket.emit('gameState', gameEngine.getCompactState(zoomLevel));
    }
  });
  
  // Client places a bet (with full database integration)
  // Bet is routed to the correct grid based on client's zoom level
  socket.on('placeBet', async (betData: {
    colId: string;
    yIndex: number;
    wager: number;
    oddsIndex: number;
    oddsMultiplier: string;
    sessionId?: string;
    basePrice?: number;
    cellSize?: number;  // IGNORED - server uses grid's cellSize
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
    
    // Get the client's zoom level and corresponding grid
    const zoomLevel = clientData.zoomLevel;
    const gameState = gameEngine.getFullState(zoomLevel);
    const currentPrice = gameState.currentPrice || 0;
    
    // Use the grid's cellSize - consistent coordinate system
    const cellSize = clientData.cellSize;
    
    // Sync server offsetX with client if they're ahead
    if (betData.clientOffsetX !== undefined && betData.clientOffsetX > gameState.offsetX) {
      gameEngine.syncOffsetX(zoomLevel, betData.clientOffsetX);
    }
    
    // If useDatabase is true (default for authenticated users), validate and record in database
    if (betData.useDatabase !== false) {
      try {
        const betService = BetServiceServer.getInstance();
        
        // Calculate win price boundaries using SERVER's tracked cellSize
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
        
        // Now place in game engine for visual tracking (on the correct grid)
        const gameBetId = `bet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const bet = gameEngine.placeBet(zoomLevel, {
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
            zoomLevel,  // Track which grid the bet is on
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
      // Place on the correct grid for this zoom level
      const bet = gameEngine.placeBet(zoomLevel, {
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
        // Broadcast bet to clients on the same grid
        io.emit('betPlaced', { ...bet, zoomLevel });
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
    
    if (!clientData) {
      callback({ success: false, results: [], error: 'Not connected' });
      return;
    }
    
    // Get client's zoom level and corresponding grid
    const zoomLevel = clientData.zoomLevel;
    
    // Sync offsetX with client on the correct grid
    if (batchData.clientOffsetX !== undefined) {
      gameEngine.syncOffsetX(zoomLevel, batchData.clientOffsetX);
    }
    
    const results: Array<{ index: number; success: boolean; betId?: string; gameBetId?: string; error?: string }> = [];
    const betsToAddToEngine: Array<{ index: number; gameBetId: string; betData: typeof batchData.bets[0]; dbBetId?: string }> = [];
    
    // Authenticated user - batch place in database first
    if (clientData.walletAddress) {
      try {
        const betService = BetServiceServer.getInstance();
        const userService = UserServiceServer.getInstance();
        const state = gameEngine.getFullState(zoomLevel);
        const basePrice = state.currentPrice || 0;
        // Use grid's cellSize
        const cellSize = clientData.cellSize;
        
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
          
          // Calculate win boundaries using SERVER's tracked cellSize
          const betBasePrice = betData.basePrice || basePrice;
          const cellYTop = betData.yIndex * cellSize;
          const cellYBottom = (betData.yIndex + 1) * cellSize;
          const winPriceMax = betBasePrice + (cellSize / 2 - cellYTop) / SERVER_CONFIG.PRICE_SCALE;
          const winPriceMin = betBasePrice + (cellSize / 2 - cellYBottom) / SERVER_CONFIG.PRICE_SCALE;
          
          // Place in database
          const dbResult = await betService.placeBet({
            walletAddress: clientData.walletAddress,
            sessionId: batchData.sessionId || `session_${socket.id}`,
            amount: betData.wager,
            multiplier,
            columnId: betData.colId,
            yIndex: betData.yIndex,
            basePrice: betBasePrice,
            cellSize,  // SERVER's tracked cellSize
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
        
        // Add all successful bets to game engine (on the correct grid)
        for (const betInfo of betsToAddToEngine) {
          const betData = betInfo.betData;
          const multiplier = parseFloat(betData.oddsMultiplier) || 1.5;
          const payout = betData.wager * multiplier;
          
          const bet = gameEngine.placeBet(zoomLevel, {
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
              zoomLevel,
            });
            io.emit('betPlaced', { ...bet, zoomLevel });
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
      // Demo mode - just add to game engine on the correct grid
      for (let i = 0; i < batchData.bets.length; i++) {
        const betData = batchData.bets[i];
        const multiplier = parseFloat(betData.oddsMultiplier) || 1.5;
        const payout = betData.wager * multiplier;
        const gameBetId = `bet_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
        
        const bet = gameEngine.placeBet(zoomLevel, {
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
          io.emit('betPlaced', { ...bet, zoomLevel });
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
    const clientData = connectedClients.get(socket.id);
    const zoomLevel = clientData?.zoomLevel || SERVER_CONFIG.ZOOM_LEVELS[0];
    socket.emit('gameState', gameEngine.getCompactState(zoomLevel));
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
  // Tick ALL grids in the multi-grid engine
  gameEngine.tick();
  
  const now = Date.now();
  
  // Broadcast game state at target rate
  // Each client receives the state for THEIR zoom level's grid
  if (now - lastBroadcast >= BROADCAST_INTERVAL) {
    // Group clients by zoom level for efficient broadcasting
    const clientsByZoom = new Map<number, string[]>();
    
    for (const [socketId, clientData] of connectedClients.entries()) {
      const zoomLevel = clientData.zoomLevel;
      if (!clientsByZoom.has(zoomLevel)) {
        clientsByZoom.set(zoomLevel, []);
      }
      clientsByZoom.get(zoomLevel)!.push(socketId);
    }
    
    // Broadcast each zoom level's state to its subscribers
    for (const [zoomLevel, socketIds] of clientsByZoom) {
      const state = gameEngine.getCompactState(zoomLevel);
      for (const socketId of socketIds) {
        io.to(socketId).emit('gameState', state);
      }
    }
    
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

