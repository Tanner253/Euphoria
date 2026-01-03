# Future Server Migration Plan

## Overview

This document outlines the plan to migrate Euphoria from serverless (Vercel) to a dedicated server architecture with WebSocket support for real-time communication.

---

## Current Architecture (Serverless)

```
┌─────────────┐     HTTP/REST      ┌─────────────────┐
│   Client    │◄──────────────────►│  Vercel Edge    │
│  (Next.js)  │                    │  Functions      │
└─────────────┘                    └────────┬────────┘
                                            │
                                            ▼
                                   ┌─────────────────┐
                                   │    MongoDB      │
                                   │    Atlas        │
                                   └─────────────────┘
```

### Limitations
- No persistent connections (WebSockets)
- 10-second function timeout
- Cold starts add latency
- Each bet requires HTTP round-trip (~100-300ms)
- No real-time push notifications
- Polling required for price updates

---

## Proposed Architecture (Server-Based)

```
┌─────────────┐    WebSocket     ┌─────────────────┐
│   Client    │◄────────────────►│   Game Server   │
│  (Next.js)  │                  │   (Node.js)     │
└─────────────┘                  └────────┬────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
           ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
           │   MongoDB   │       │    Redis    │       │  Price Feed │
           │   Atlas     │       │   (Cache)   │       │  (Pyth/WS)  │
           └─────────────┘       └─────────────┘       └─────────────┘
```

---

## Technology Stack

### Option A: Node.js + Socket.io (Recommended)
- **Server**: Node.js with Express + Socket.io
- **Hosting**: Railway, Render, Fly.io, or AWS EC2
- **Pros**: Familiar stack, large ecosystem, easy Socket.io integration
- **Cons**: Need to manage server scaling

### Option B: Bun + Elysia
- **Server**: Bun runtime with Elysia framework
- **Hosting**: Fly.io (best Bun support)
- **Pros**: Faster than Node, native WebSocket support, TypeScript-first
- **Cons**: Newer ecosystem

### Option C: Go + Gorilla WebSocket
- **Server**: Go with Fiber or Gin framework
- **Hosting**: Any VPS or container platform
- **Pros**: Extremely performant, low resource usage
- **Cons**: Different language, steeper learning curve

---

## WebSocket Event Schema

### Client → Server Events

```typescript
// Place single bet
{
  event: 'bet:place',
  data: {
    columnId: string,
    yIndex: number,
    amount: number,
    multiplier: number
  }
}

// Place batch of bets (drag mode)
{
  event: 'bet:place-batch',
  data: {
    bets: Array<{
      columnId: string,
      yIndex: number,
      amount: number,
      multiplier: number
    }>
  }
}

// Resolve bet
{
  event: 'bet:resolve',
  data: {
    betId: string,
    priceAtCrossing: number
  }
}

// Subscribe to channels
{
  event: 'subscribe',
  data: {
    channels: ['price', 'user:balance', 'admin:bets']
  }
}
```

### Server → Client Events

```typescript
// Price update (broadcast to all)
{
  event: 'price:update',
  data: {
    price: number,
    timestamp: number,
    source: string
  }
}

// Bet placed confirmation
{
  event: 'bet:placed',
  data: {
    betId: string,
    yIndex: number,
    amount: number,
    multiplier: number,
    winPriceMin: number,
    winPriceMax: number,
    newBalance: number
  }
}

// Bet resolved
{
  event: 'bet:resolved',
  data: {
    betId: string,
    isWin: boolean,
    actualWin: number,
    newBalance: number,
    priceAtResolution: number
  }
}

// Balance update
{
  event: 'balance:update',
  data: {
    balance: number,
    reason: string
  }
}

// Error
{
  event: 'error',
  data: {
    code: string,
    message: string,
    betId?: string
  }
}
```

---

## Bet Batching Implementation

### Current: Sequential HTTP Requests
```
Bet 1 ──► Server ──► Response (150ms)
Bet 2 ──► Server ──► Response (150ms)
Bet 3 ──► Server ──► Response (150ms)
Total: 450ms
```

### Proposed: WebSocket Batch
```
[Bet 1, Bet 2, Bet 3] ──► Server ──► [Response 1, 2, 3]
Total: ~50ms
```

### Batch Endpoint (Interim Solution)

Can be added NOW to existing serverless architecture:

```typescript
// POST /api/bets/place-batch
interface BatchBetRequest {
  bets: Array<{
    columnId: string;
    yIndex: number;
    basePrice: number;
    cellSize: number;
    amount: number;
    multiplier: number;
  }>;
}

interface BatchBetResponse {
  success: boolean;
  results: Array<{
    success: boolean;
    betId?: string;
    error?: string;
  }>;
  newBalance: number;
  totalDeducted: number;
}
```

---

## Migration Steps

### Phase 1: Preparation (No Downtime)
1. [ ] Set up dedicated server infrastructure
2. [ ] Deploy server alongside Vercel (both running)
3. [ ] Implement WebSocket server with same business logic
4. [ ] Add feature flag for WebSocket vs HTTP mode
5. [ ] Test WebSocket mode in development

### Phase 2: Gradual Migration
1. [ ] Enable WebSocket for price feed only (low risk)
2. [ ] Migrate balance updates to WebSocket
3. [ ] Migrate bet placement to WebSocket
4. [ ] Migrate bet resolution to WebSocket
5. [ ] Monitor for issues, rollback if needed

### Phase 3: Full Migration
1. [ ] Disable HTTP fallback
2. [ ] Shut down Vercel API routes (keep frontend)
3. [ ] Update DNS/routing
4. [ ] Remove old serverless code

### Phase 4: Optimization
1. [ ] Implement Redis caching for hot data
2. [ ] Add connection pooling
3. [ ] Implement rate limiting at WebSocket level
4. [ ] Add horizontal scaling (multiple server instances)

---

## Server Infrastructure Options

### Budget Option (~$5-20/month)
- **Railway** or **Render** - Simple deployment, auto-scaling
- **Fly.io** - Edge deployment, good for global users
- Single instance, vertical scaling

### Production Option (~$50-200/month)
- **AWS ECS** or **Google Cloud Run** - Container orchestration
- **DigitalOcean Kubernetes** - Managed K8s
- Multiple instances, load balanced

### Enterprise Option (~$500+/month)
- **AWS with Auto Scaling Groups**
- **Dedicated Redis cluster**
- **Multi-region deployment**
- **DDoS protection**

---

## Real-Time Price Feed

### Current: HTTP Polling
- Client polls `/api/rates` every 100ms
- High latency, wasted requests when price unchanged

### Proposed: WebSocket Stream
```typescript
// Server connects directly to Pyth Network WebSocket
const pythWs = new WebSocket('wss://hermes.pyth.network/ws');

pythWs.on('message', (data) => {
  const price = parsePrice(data);
  // Broadcast to all connected clients instantly
  io.emit('price:update', { price, timestamp: Date.now() });
});
```

Benefits:
- Sub-10ms price updates
- No wasted requests
- Lower client CPU usage
- Consistent price across all clients

---

## Admin Panel Real-Time Features

With WebSocket, admin panel gets:
- Live bet feed (see bets as they're placed)
- Real-time user activity
- Instant balance change notifications
- Live profit/loss tracking
- Alert system for suspicious activity

---

## Security Considerations

### WebSocket Authentication
```typescript
// On connection, verify JWT
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const decoded = verifyJWT(token);
    socket.userId = decoded.walletAddress;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});
```

### Rate Limiting
```typescript
// Per-user rate limiting
const rateLimiter = new Map<string, number>();

socket.on('bet:place', (data) => {
  const count = rateLimiter.get(socket.userId) || 0;
  if (count > 10) { // Max 10 bets per second
    return socket.emit('error', { code: 'RATE_LIMITED' });
  }
  rateLimiter.set(socket.userId, count + 1);
  // Process bet...
});
```

### Connection Limits
- Max connections per IP: 5
- Max connections per user: 3
- Idle timeout: 5 minutes
- Max message size: 10KB

---

## Estimated Timeline

| Phase | Duration | Effort |
|-------|----------|--------|
| Phase 1: Preparation | 1-2 weeks | High |
| Phase 2: Gradual Migration | 1 week | Medium |
| Phase 3: Full Migration | 2-3 days | Low |
| Phase 4: Optimization | Ongoing | Medium |

**Total: ~3-4 weeks for full migration**

---

## Rollback Plan

If issues occur during migration:
1. Feature flag disables WebSocket mode
2. Clients fall back to HTTP automatically
3. Vercel functions remain operational
4. No data loss (same database)

---

## Cost Comparison

| Architecture | Monthly Cost | Latency | Scalability |
|--------------|--------------|---------|-------------|
| Current (Vercel) | ~$20 | 100-300ms | Auto |
| Server (Basic) | ~$25 | 10-50ms | Manual |
| Server (Production) | ~$100 | 10-50ms | Auto |

---

## Next Steps

1. **Decision**: Choose hosting provider (Railway recommended for simplicity)
2. **Spike**: Build minimal WebSocket server POC
3. **Test**: Load test with simulated users
4. **Plan**: Schedule migration window
5. **Execute**: Follow migration phases

---

*Document created: January 2026*
*Status: PLANNED*

