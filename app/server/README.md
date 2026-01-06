# Euphoria Game Server

Authoritative game server for the Euphoria prediction market.

## Architecture

```
                    ┌─────────────────────┐
                    │   GAME SERVER       │
                    │  (Socket.io)        │
                    │                     │
                    │  ┌───────────────┐  │
                    │  │ Price Service │──┼──→ Coinbase WebSocket
                    │  └───────────────┘  │
                    │         │           │
                    │  ┌───────────────┐  │
                    │  │ Game Engine   │  │  ← Single Source of Truth
                    │  │ (Authoritative│  │
                    │  │  Game State)  │  │
                    │  └───────────────┘  │
                    │         │           │
                    └─────────┼───────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌───────────┐   ┌───────────┐   ┌───────────┐
       │ Client A  │   │ Client B  │   │ Client C  │
       │ (Render)  │   │ (Render)  │   │ (Render)  │
       └───────────┘   └───────────┘   └───────────┘
```

## Setup

```bash
cd server
npm install
```

## Development

```bash
# Run server only
npm run dev

# Run from root (both Next.js and server)
cd ..
npm run dev:all
```

## Environment Variables

Create a `.env` file:

```env
PORT=3001
CORS_ORIGIN=http://localhost:3000
PRICE_PROVIDER=coinbase
```

## API Endpoints

### HTTP

- `GET /health` - Server health check
- `GET /config` - Get game configuration (for client sync)

### Socket.io Events

**Client → Server:**
- `identify` - Authenticate client with wallet address
- `setZoom` - Update client zoom level preference
- `placeBet` - Place a bet (returns result via callback)
- `requestState` - Request full game state (for reconnection)
- `ping` - Latency measurement

**Server → Client:**
- `gameState` - Authoritative game state (60fps broadcast)
- `betPlaced` - Bet placement confirmation
- `pong` - Latency response

## Production Deployment (Render)

1. Create a new Web Service on Render
2. Set build command: `npm install && npm run build`
3. Set start command: `npm run start`
4. Add environment variables:
   - `PORT=10000` (Render assigns this)
   - `CORS_ORIGIN=https://your-frontend-domain.com`
   - `PRICE_PROVIDER=coinbase`

5. Update your Next.js app's environment:
   - `NEXT_PUBLIC_GAME_SERVER_URL=https://your-server.onrender.com`

