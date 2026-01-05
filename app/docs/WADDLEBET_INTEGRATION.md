# WaddleBet Integration - Euphoria Requirements

> **Last Updated**: January 2026  
> **Security Review**: ✅ Includes server-side win verification  
> **WaddleBet Doc**: See `waddlebet/docs/EUPHORIA_INTEGRATION.md` for their implementation  
> **Quick Reference**: See `waddlebet/docs/EUPHORIA_CHECKLIST.md` for both teams

## Overview

This document outlines the changes required in **Euphoria** to support embedding inside **WaddleBet** (waddle.bet) as an in-game minigame.

When embedded, Euphoria will use **Pebbles** (WaddleBet's currency) instead of **Gems**, with balance management handled by WaddleBet's WebSocket server.

---

## Current Euphoria Architecture (Verified)

**Key Files**:
| File | Purpose | Lines |
|------|---------|-------|
| `src/contexts/WalletContext.tsx` | Auth state, balance, `useWallet()` hook | ~320 |
| `src/hooks/useGameEngine.ts` | Game logic, bet placement, resolution | ~1300 |
| `src/lib/services/GameAPI.ts` | API client for bets (`gameAPI` singleton) | ~290 |
| `src/components/game/LeftSidebar.tsx` | UI sidebar, balance display | ~650 |
| `next.config.ts` | Next.js config (currently empty) | ~7 |

**Key Exports from WalletContext**:
- `useWallet()` hook returns: `isAuthenticated`, `gemsBalance`, `isDemoMode`, `walletAddress`, `disconnect()`, `updateGemsBalance()`

**Key GameAPI Methods**:
- `gameAPI.setToken(token)` - Set auth JWT
- `gameAPI.placeBet(params)` - Place a bet
- `gameAPI.resolveBet(betId, ...)` - Resolve a bet
- `gameAPI.getBalance()` - Get user balance

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     WADDLEBET (Parent Window)                   │
│                                                                 │
│   ┌─────────────────┐                                           │
│   │  WebSocket      │◄──── Balance Authority                    │
│   │  Server         │                                           │
│   └────────┬────────┘                                           │
│            │                                                    │
│   ┌────────▼────────┐         postMessage         ┌──────────┐ │
│   │  WaddleBet      │◄───────────────────────────►│ EUPHORIA │ │
│   │  React App      │                             │ (iframe) │ │
│   └─────────────────┘                             └──────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Points**:
- Euphoria runs in an iframe inside WaddleBet
- Communication via `window.postMessage()`
- WaddleBet server is the authority for Pebble balance
- No changes needed to Euphoria's Vercel backend

---

## Required Changes

### 1. Embedded Mode Detection

**File**: `src/contexts/WalletContext.tsx`

Add detection for iframe embedding:

```typescript
// At the top of WalletProvider
const isEmbedded = typeof window !== 'undefined' && window.parent !== window;
const WADDLEBET_ORIGIN = process.env.NEXT_PUBLIC_WADDLEBET_ORIGIN || 'https://waddle.bet';

// Add to context type
interface WalletContextType {
  // ... existing fields ...
  isEmbedded: boolean;
  embeddedBalance: number | null;
}
```

### 2. PostMessage Handler

**File**: `src/contexts/WalletContext.tsx`

Add message listener inside `WalletProvider` function (around line 69, after existing state declarations):

```typescript
// EXISTING STATE (around lines 70-79):
const [isConnected, setIsConnected] = useState(false);
const [isConnecting, setIsConnecting] = useState(false);
// ... etc

// ADD THESE NEW STATE VARIABLES after line 79:
const [embeddedBalance, setEmbeddedBalance] = useState<number | null>(null);
const [embeddedWallet, setEmbeddedWallet] = useState<string | null>(null);

// ADD THIS EFFECT after the existing useEffects (around line 173):
// Handle embedded mode communication with WaddleBet
useEffect(() => {
  if (!isEmbedded) return;
  
  const handleMessage = (event: MessageEvent) => {
    // SECURITY: Only accept messages from WaddleBet
    if (!event.origin.includes('waddle.bet') && !event.origin.includes('localhost')) {
      console.warn('[Euphoria] Rejected message from:', event.origin);
      return;
    }
    
    const { type, payload } = event.data;
    console.log('[Euphoria] Received from WaddleBet:', type);
    
    switch (type) {
      case 'WADDLEBET_INIT':
        // Initial state from parent
        setEmbeddedWallet(payload.walletAddress);
        setEmbeddedBalance(payload.balance);
        // Auto-authenticate in embedded mode
        setIsAuthenticated(true);
        setIsDemoMode(false);
        console.log('[Euphoria] Embedded mode initialized with balance:', payload.balance);
        break;
        
      case 'WADDLEBET_BALANCE':
        // Balance update from parent
        setEmbeddedBalance(payload.balance);
        break;
    }
  };
  
  window.addEventListener('message', handleMessage);
  
  // Notify parent we're ready
  window.parent.postMessage({ type: 'EUPHORIA_READY' }, WADDLEBET_ORIGIN);
  
  return () => window.removeEventListener('message', handleMessage);
}, [isEmbedded]);

// MODIFY the balance getter (around line 47 in the return value):
// Change: gemsBalance
// To: isEmbedded && embeddedBalance !== null ? embeddedBalance : gemsBalance
```

**Also add to the context type** (around line 17):
```typescript
interface WalletContextType {
  // ... existing fields ...
  isEmbedded: boolean;          // ADD
  embeddedBalance: number | null; // ADD
}
```

### 3. Bet Request Bridge (NEW FILE)

**File**: `src/lib/waddlebetBridge.ts` (**CREATE THIS FILE**)

```typescript
/**
 * WaddleBet Integration Bridge
 * 
 * Handles postMessage communication when Euphoria is embedded in WaddleBet.
 * This file enables Pebbles-based gameplay within the WaddleBet game world.
 */

const WADDLEBET_ORIGIN = process.env.NEXT_PUBLIC_WADDLEBET_ORIGIN || 'https://waddle.bet';

/**
 * Check if running inside WaddleBet iframe
 */
export function isEmbeddedInWaddleBet(): boolean {
  if (typeof window === 'undefined') return false;
  return window.parent !== window;
}

/**
 * Request bet approval from WaddleBet parent
 * WaddleBet will validate Pebble balance and deduct if approved
 */
export async function requestBetFromWaddleBet(amount: number): Promise<{
  success: boolean;
  newBalance?: number;
  betId?: string;
  error?: string;
}> {
  if (!isEmbeddedInWaddleBet()) {
    return { success: false, error: 'Not embedded in WaddleBet' };
  }
  
  return new Promise((resolve) => {
    const requestId = `bet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const handler = (event: MessageEvent) => {
      // Validate origin
      if (!event.origin.includes('waddle.bet') && !event.origin.includes('localhost')) return;
      if (event.data.requestId !== requestId) return;
      if (event.data.type !== 'WADDLEBET_BET_RESPONSE') return;
      
      window.removeEventListener('message', handler);
      clearTimeout(timeoutId);
      resolve(event.data.payload);
    };
    
    window.addEventListener('message', handler);
    
    // Send request to parent
    window.parent.postMessage({
      type: 'EUPHORIA_PLACE_BET',
      payload: { amount },
      requestId
    }, WADDLEBET_ORIGIN);
    
    // Timeout after 5 seconds
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', handler);
      console.warn('[WaddleBet Bridge] Bet request timed out');
      resolve({ success: false, error: 'TIMEOUT' });
    }, 5000);
  });
}

/**
 * Report bet result to WaddleBet parent
 * WaddleBet will credit Pebbles for wins
 */
export function reportBetResult(result: {
  won: boolean;
  winAmount: number;
  betId: string;
}): void {
  if (!isEmbeddedInWaddleBet()) return;
  
  console.log('[WaddleBet Bridge] Reporting bet result:', result);
  
  window.parent.postMessage({
    type: 'EUPHORIA_BET_RESULT',
    payload: result
  }, WADDLEBET_ORIGIN);
}

/**
 * Request to exit Euphoria and return to WaddleBet
 */
export function requestExit(): void {
  if (!isEmbeddedInWaddleBet()) return;
  
  console.log('[WaddleBet Bridge] Requesting exit');
  
  window.parent.postMessage({
    type: 'EUPHORIA_EXIT',
    payload: {}
  }, WADDLEBET_ORIGIN);
}

/**
 * Request current balance from WaddleBet
 */
export function requestBalance(): void {
  if (!isEmbeddedInWaddleBet()) return;
  
  window.parent.postMessage({
    type: 'EUPHORIA_REQUEST_BALANCE',
    payload: {}
  }, WADDLEBET_ORIGIN);
}
```

### 4. Modify useGameEngine for Embedded Mode

**File**: `src/hooks/useGameEngine.ts` (~1300 lines - be careful!)

The key function is `placeBetAt` (around line 255). Modify it to check for embedded mode:

```typescript
// At the top of useGameEngine.ts, add import
import { requestBetFromWaddleBet, reportBetResult, isEmbeddedInWaddleBet } from '@/lib/waddlebetBridge';

// Inside placeBetAt function (around line 255), BEFORE the existing balance check:
const placeBetAt = useCallback(async (screenX: number, screenY: number, allowDuplicate = false) => {
  const currentBalance = balanceRef.current;
  const currentBetAmount = betAmountRef.current;
  // ... existing code ...
  
  // ADD THIS: Check if embedded in WaddleBet BEFORE demo mode check
  if (isEmbeddedInWaddleBet()) {
    console.log('[Euphoria] Embedded mode - requesting bet from WaddleBet');
    const approval = await requestBetFromWaddleBet(currentBetAmount);
    
    if (!approval.success) {
      console.warn('[Euphoria] Bet rejected by WaddleBet:', approval.error);
      onError?.(approval.error || 'WaddleBet rejected the bet');
      return false;
    }
    
    // WaddleBet approved - continue with LOCAL visual bet only
    // Don't call gameAPI.placeBet() - WaddleBet handles the balance
    // ... create visual bet and return ...
  }
  
  // EXISTING CODE (around line 362-364):
  // DEMO MODE: Done - no server call needed
  if (!isAuthenticated) {
    return true;
  }
  // ... rest of existing code ...
}, [/* deps */]);
```

**For bet resolution** (around line 547-576 in the `checkBets` function):

```typescript
// Inside checkBets, after a bet resolves, ADD:
if (isEmbeddedInWaddleBet() && isWin) {
  reportBetResult({
    won: true,
    winAmount: bet.amount * bet.multiplier,
    betId: bet.id
  });
}
```

**IMPORTANT**: The useGameEngine hook is complex. Test thoroughly after changes!

### 5. Add Exit Button for Embedded Mode

**File**: `src/components/game/LeftSidebar.tsx` (650 lines)

The LeftSidebar component uses the `useWallet()` hook. You need to:

1. **Add to props interface** (around line 29):
```tsx
interface LeftSidebarProps {
  // ... existing props ...
  isEmbedded?: boolean;  // ADD
  onExitEmbedded?: () => void;  // ADD
}
```

2. **Add to component parameters** (around line 64):
```tsx
export default function LeftSidebar({
  // ... existing params ...
  isEmbedded = false,  // ADD
  onExitEmbedded,      // ADD
}: LeftSidebarProps) {
```

3. **Add exit button in mobile layout** (around line 235, after the Roadmap button):
```tsx
{/* Exit to WaddleBet - Mobile */}
{isEmbedded && (
  <button
    onClick={onExitEmbedded}
    className="pointer-events-auto w-10 h-10 rounded-xl bg-red-500/80 flex items-center justify-center active:scale-95 transition-transform"
  >
    <X size={18} className="text-white" />
  </button>
)}
```

4. **Add exit button in desktop layout** (around line 520, after Roadmap button):
```tsx
{/* Exit to WaddleBet - Desktop */}
{isEmbedded && (
  <button
    onClick={onExitEmbedded}
    className={`w-full p-2 rounded-xl bg-red-500/80 hover:bg-red-500 transition-all ${!isExpanded && 'flex justify-center'}`}
  >
    <div className={`flex items-center gap-2 ${!isExpanded && 'flex-col'}`}>
      <X size={isExpanded ? 16 : 20} className="text-white" />
      {isExpanded && <span className="text-xs font-semibold text-white">Exit to WaddleBet</span>}
    </div>
  </button>
)}
```

5. **Change currency display when embedded** - Find where `Gem` icon and balance are displayed, add:
```tsx
// Around line 376 (gems display in sidebar)
<Gem size={isExpanded ? 18 : 22} className="text-purple-400" />
// Change to:
{isEmbedded ? (
  <span className="text-lg">🪨</span>  // Pebble emoji
) : (
  <Gem size={isExpanded ? 18 : 22} className="text-purple-400" />
)}
```

### 6. CORS/Frame Headers

**File**: `next.config.ts`

> **NOTE**: This file is currently EMPTY in the Euphoria codebase. Replace the entire contents:

**Current contents (empty)**:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

**Replace with**:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow WaddleBet to embed Euphoria in an iframe
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            // frame-ancestors controls which domains can embed this site
            value: "frame-ancestors 'self' https://waddle.bet https://*.waddle.bet http://localhost:* http://127.0.0.1:*"
          },
        ]
      }
    ];
  }
};

export default nextConfig;
```

**Why this matters**: Without this header, browsers will block WaddleBet from loading Euphoria in an iframe due to clickjacking protection defaults.

### 7. Environment Variables

**File**: `.env.local` (add)

```env
# WaddleBet Integration
NEXT_PUBLIC_WADDLEBET_ORIGIN=https://waddle.bet
```

### 8. Currency Display Override

**File**: `src/components/game/LeftSidebar.tsx` (or wherever balance is displayed)

```tsx
// Change Gems → Pebbles display when embedded
const currencyName = isEmbedded ? 'Pebbles' : 'Gems';
const currencyIcon = isEmbedded ? '🪨' : '💎';

// In render
<span className="text-yellow-400 font-bold">
  {currencyIcon} {balance} {currencyName}
</span>
```

---

## Message Protocol Reference

### Messages Euphoria SENDS to WaddleBet

| Type | Payload | When |
|------|---------|------|
| `EUPHORIA_READY` | `{}` | On iframe load |
| `EUPHORIA_REQUEST_BALANCE` | `{}` | When balance refresh needed |
| `EUPHORIA_PLACE_BET` | `{ amount: number }` | User attempts to bet |
| `EUPHORIA_BET_RESULT` | `{ won: boolean, winAmount: number, betId: string }` | After bet resolves |
| `EUPHORIA_EXIT` | `{}` | User clicks exit |

### Messages Euphoria RECEIVES from WaddleBet

| Type | Payload | Action |
|------|---------|--------|
| `WADDLEBET_INIT` | `{ walletAddress, balance, playerName }` | Store initial state |
| `WADDLEBET_BALANCE` | `{ balance: number }` | Update displayed balance |
| `WADDLEBET_BET_RESPONSE` | `{ success, newBalance?, error?, betId? }` | Resolve pending bet request |

---

## Testing Locally

### 1. Run Euphoria

```bash
cd app
npm run dev
# Runs on http://localhost:3000
```

### 2. Test Embedded Mode

Create a simple test HTML file:

```html
<!DOCTYPE html>
<html>
<head>
  <title>WaddleBet Embed Test</title>
</head>
<body style="margin:0; background:#000;">
  <div style="padding:10px; background:#333; color:#fff;">
    <button onclick="sendBalance()">Send Balance (1000)</button>
    <button onclick="approveBet()">Approve Next Bet</button>
  </div>
  
  <iframe 
    id="euphoria" 
    src="http://localhost:3000?embedded=true" 
    style="width:100%; height:90vh; border:0;"
  ></iframe>
  
  <script>
    const iframe = document.getElementById('euphoria');
    
    window.addEventListener('message', (e) => {
      console.log('From Euphoria:', e.data);
      
      if (e.data.type === 'EUPHORIA_READY') {
        iframe.contentWindow.postMessage({
          type: 'WADDLEBET_INIT',
          payload: { walletAddress: 'TestWallet123', balance: 1000, playerName: 'TestPenguin' }
        }, '*');
      }
      
      if (e.data.type === 'EUPHORIA_PLACE_BET') {
        // Auto-approve for testing
        iframe.contentWindow.postMessage({
          type: 'WADDLEBET_BET_RESPONSE',
          payload: { success: true, newBalance: 990, betId: 'test_bet_1' },
          requestId: e.data.requestId
        }, '*');
      }
    });
    
    function sendBalance() {
      iframe.contentWindow.postMessage({
        type: 'WADDLEBET_BALANCE',
        payload: { balance: 1000 }
      }, '*');
    }
  </script>
</body>
</html>
```

---

## Security Checklist

- [ ] Origin validation in message handler (reject unknown origins)
- [ ] No sensitive data in postMessage payloads
- [ ] Timeout on pending bet requests
- [ ] Graceful handling when parent doesn't respond
- [ ] No direct DOM manipulation of parent window

---

## Deployment Notes

1. **Frame Headers**: Must be deployed to production before WaddleBet can embed
2. **CORS**: No additional CORS needed (postMessage doesn't require it)
3. **Vercel**: No backend changes needed, all logic is client-side

---

## Files to Modify Summary

| File | Current State | Changes Needed |
|------|---------------|----------------|
| `src/contexts/WalletContext.tsx` | 320 lines, has `useWallet()` | Add embedded mode detection + message handler |
| `src/lib/waddlebetBridge.ts` | **Does not exist** | CREATE: Bridge functions for postMessage |
| `src/hooks/useGameEngine.ts` | 1300 lines, has `placeBetAt()` | Modify lines ~255-365 for embedded check |
| `src/lib/services/GameAPI.ts` | 290 lines, singleton `gameAPI` | No changes needed (bypassed when embedded) |
| `src/components/game/LeftSidebar.tsx` | 650 lines, has balance display | Add exit button + currency name override |
| `next.config.ts` | **Currently empty** | REPLACE: Add CSP frame-ancestors header |
| `.env.local` | Exists | ADD: WADDLEBET_ORIGIN variable |

---

## Timeline Estimate

| Task | Time |
|------|------|
| Embedded mode detection | 30 min |
| PostMessage bridge | 1-2 hours |
| Game engine modifications | 1-2 hours |
| UI changes (exit button, currency) | 30 min |
| Testing | 1-2 hours |
| **Total** | **4-6 hours** |

---

*Last Updated: January 2026*

