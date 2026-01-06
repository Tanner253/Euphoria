'use client';

/**
 * useGameEngine - Core game logic hook for the prediction market
 * 
 * SERVER-AUTHORITATIVE: All bet placement and resolution goes through server APIs
 * The client is only responsible for rendering - never trusted for balance/outcomes
 * 
 * SOCKET INTEGRATION: Receives heatmap data from server to show other players' bets
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { GAME_CONFIG, calculateMultiplier } from '@/lib/game/gameConfig';
import type { ServerConfig } from '@/lib/game/gameConfig';
import { getGameSounds } from '@/lib/audio/GameSounds';
// NOTE: All bet operations now go through Socket.io - no REST API
import type { Bet, Column, GameState, VolatilityLevel, Particle, SpecialCell } from '@/lib/game/types';

// ========== HEATMAP TYPES AND HELPERS ==========

interface HeatmapCell {
  colId: string;
  yIndex: number;
  betCount: number;
  totalWagered: number;
  heat: number;  // 0-1 normalized
}

interface ServerBetData {
  id: string;
  colId: string;
  yIndex: number;
  walletAddress: string;
  wager: number;
  status: string;
}

/**
 * Get thermal color for heatmap based on heat intensity
 * @param heat - 0 to 1 normalized heat value
 * @returns CSS color string
 */
function getHeatColor(heat: number): string {
  if (heat <= 0) return 'transparent';
  
  // Thermal gradient: blue (cold) -> cyan -> green -> yellow -> orange -> red (hot)
  const colors = [
    { pos: 0, r: 0, g: 100, b: 255 },     // Blue (low)
    { pos: 0.25, r: 0, g: 200, b: 200 },  // Cyan
    { pos: 0.5, r: 0, g: 255, b: 100 },   // Green
    { pos: 0.75, r: 255, g: 200, b: 0 },  // Yellow-Orange
    { pos: 1, r: 255, g: 50, b: 50 },     // Red (hot)
  ];
  
  // Clamp heat
  const h = Math.min(Math.max(heat, 0), 1);
  
  // Find the two colors to interpolate between
  let lower = colors[0];
  let upper = colors[colors.length - 1];
  
  for (let i = 0; i < colors.length - 1; i++) {
    if (h >= colors[i].pos && h <= colors[i + 1].pos) {
      lower = colors[i];
      upper = colors[i + 1];
      break;
    }
  }
  
  // Interpolate
  const range = upper.pos - lower.pos;
  const factor = range === 0 ? 0 : (h - lower.pos) / range;
  
  const r = Math.round(lower.r + (upper.r - lower.r) * factor);
  const g = Math.round(lower.g + (upper.g - lower.g) * factor);
  const b = Math.round(lower.b + (upper.b - lower.b) * factor);
  
  // Alpha based on heat intensity (more visible when hotter)
  const alpha = 0.15 + heat * 0.4;
  
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Socket URL for game server
const GAME_SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'http://localhost:3002';

// ========== PARTICLE SYSTEM HELPERS ==========

let particleIdCounter = 0;

function createParticle(
  x: number,
  y: number,
  type: Particle['type'],
  color: string,
  options?: Partial<Particle>
): Particle {
  const baseVelocity = type === 'confetti' ? 4 : type === 'sparkle' ? 2 : 1;
  const angle = Math.random() * Math.PI * 2;
  
  return {
    id: `particle-${particleIdCounter++}`,
    x,
    y,
    vx: Math.cos(angle) * baseVelocity * (0.5 + Math.random()),
    vy: Math.sin(angle) * baseVelocity * (0.5 + Math.random()) - 1, // slight upward bias
    life: 1,
    maxLife: type === 'confetti' ? 1.2 : type === 'sparkle' ? 0.8 : 0.6,
    size: type === 'confetti' ? 4 + Math.random() * 4 : type === 'sparkle' ? 3 + Math.random() * 3 : 2,
    color,
    type,
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 720,
    ...options,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _emitBetPlacedParticles(x: number, y: number): Particle[] {
  const particles: Particle[] = [];
  const colors = ['#c8e64c', '#e8f76c', '#98b62c', '#ffffff'];
  
  // Burst of sparkles
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    particles.push(createParticle(x, y, 'sparkle', colors[i % colors.length], {
      vx: Math.cos(angle) * 3,
      vy: Math.sin(angle) * 3,
    }));
  }
  
  // Some confetti
  for (let i = 0; i < 6; i++) {
    particles.push(createParticle(x, y, 'confetti', colors[i % colors.length]));
  }
  
  return particles;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _emitWinParticles(x: number, y: number): Particle[] {
  const particles: Particle[] = [];
  const colors = ['#4ade80', '#22c55e', '#fbbf24', '#ffffff', '#f472b6'];
  
  // Big celebration burst
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const speed = 4 + Math.random() * 3;
    particles.push(createParticle(x, y, 'confetti', colors[i % colors.length], {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      size: 5 + Math.random() * 5,
      maxLife: 1.5,
    }));
  }
  
  // Sparkle ring
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    particles.push(createParticle(x, y, 'sparkle', '#ffffff', {
      vx: Math.cos(angle) * 5,
      vy: Math.sin(angle) * 5,
      maxLife: 1,
    }));
  }
  
  return particles;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _updateParticles(particles: Particle[], deltaTime: number): Particle[] {
  return particles
    .map(p => ({
      ...p,
      x: p.x + p.vx * deltaTime * 60,
      y: p.y + p.vy * deltaTime * 60,
      vy: p.vy + 0.15 * deltaTime * 60, // gravity
      life: p.life - (deltaTime / p.maxLife),
      rotation: (p.rotation || 0) + (p.rotationSpeed || 0) * deltaTime,
    }))
    .filter(p => p.life > 0);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _renderParticles(ctx: CanvasRenderingContext2D, particles: Particle[], offsetX: number) {
  particles.forEach(p => {
    const screenX = p.x - offsetX;
    const alpha = Math.max(0, p.life);
    const scale = 0.5 + p.life * 0.5;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(screenX, p.y);
    ctx.rotate((p.rotation || 0) * Math.PI / 180);
    ctx.scale(scale, scale);
    
    if (p.type === 'confetti') {
      // Rectangle confetti
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    } else if (p.type === 'sparkle') {
      // Star sparkle
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const innerAngle = angle + Math.PI / 4;
        ctx.lineTo(Math.cos(angle) * p.size, Math.sin(angle) * p.size);
        ctx.lineTo(Math.cos(innerAngle) * p.size * 0.4, Math.sin(innerAngle) * p.size * 0.4);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      // Circle bubble
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  });
}

export interface WinInfo {
  amount: number;
  id: string;
  screenX: number;  // Screen X position of winning cell (for popup)
  screenY: number;  // Screen Y position of winning cell (for popup)
}

// ========== PRICE ACTION CHAT BUBBLES ==========
// Messages the price head says based on movement

interface ChatBubble {
  message: string;
  startTime: number;
  duration: number;
}

const CHAT_MESSAGES = {
  // Small up movement
  smallUp: [
    "lfg",
    "nice",
    "we move",
    "green candle",
    "up only",
    "wagmi",
    "vibes",
    "based",
    "cooking",
    "pump it",
    "bullish",
    "here we go",
    "warming up",
    "momentum",
    "tick tick tick",
    "engine starting",
    "waking up",
    "signs of life",
    "finally",
    "ok ok ok",
    "yes yes yes",
    "there it is",
    "she's moving",
    "accumulation done?",
    "breakout loading",
    "coiling up",
    "👀",
    "hmm interesting",
    "this is it",
    "trust the process",
    "patience paying off",
    "told ya",
    "ez clap",
    "free money",
    "send it",
  ],
  // Big pump
  bigUp: [
    "SOLANA TO $1000 🚀",
    "WE'RE SO BACK",
    "GENERATIONAL WEALTH",
    "TOLD YOU SO",
    "NEVER SELLING",
    "RETIREMENT INCOMING",
    "MOON MISSION",
    "LAMBO WHEN",
    "NEW ATH LOADING",
    "BEARS IN SHAMBLES",
    "VERTICAL",
    "GOD CANDLE",
    "FACE MELTING",
    "SHORTS LIQUIDATED",
    "NUMBER GO UP",
    "PRINTER GO BRRR",
    "CANT STOP WONT STOP",
    "BEARS R FUK",
    "ABSOLUTELY SENDING",
    "THIS IS WHY WE HODL",
    "WERE ALL GONNA MAKE IT",
    "HOLY GREEN DILDO",
    "GET IN LOSERS",
    "THE FLIPPENING",
    "SUPERCYCLE CONFIRMED",
    "HYPERBITCOINIZATION",
    "MAINSTREAM ADOPTION",
    "INSTITUTIONAL FOMO",
    "PARABOLIC",
    "UP ONLY SZN",
    "BEARS EXTINCT",
    "SELLING IS COPE",
    "DIAMOND HANDS REWARDED",
    "I KNEW IT",
    "WITNESS ME",
  ],
  // Small down movement
  smallDown: [
    "just a dip",
    "shaking out weak hands",
    "discount",
    "loading zone",
    "buy the dip",
    "healthy pullback",
    "accumulation",
    "paper hands out",
    "just noise",
    "zoom out",
    "sale time",
    "black friday",
    "cheaper coins",
    "gift from whales",
    "stop loss hunting",
    "manipulation",
    "its fine",
    "normal volatility",
    "expected",
    "consolidation",
    "nothing burger",
    "meh",
    "seen worse",
    "whatever",
    "doesnt phase me",
    "diamond hands activated",
    "not selling",
    "buying opportunity",
    "thank you whales",
    "DCA time",
    "stacking sats",
    "lower = more coins",
    "this is temporary",
    "zoom out ser",
  ],
  // Big dump
  bigDown: [
    "JEETS GONNA JEET",
    "WHO SOLD 💀",
    "PAIN",
    "THIS IS FINE 🔥",
    "DEVS DO SOMETHING",
    "RUG WHERE",
    "MY PORTFOLIO 📉",
    "NOT LIKE THIS",
    "CAPITULATION",
    "GG NO RE",
    "SIR SIR SIR",
    "HELLO SEC?",
    "TURN IT OFF",
    "MAKE IT STOP",
    "I WANT MY MOM",
    "RED WEDDING",
    "BLOOD IN STREETS",
    "FEAR INDEX 100",
    "EXTREME GREED GONE",
    "EVERYONE PANIC",
    "SELL SELL SELL",
    "jk diamond hands",
    "THIS IS A TEST",
    "SHAKEOUT SZN",
    "WHALES ACCUMULATING",
    "WEAK HANDS REKT",
    "BYE PAPER HANDS",
    "SEE YA LEVERAGED LONGS",
    "SHOULDA TOOK PROFIT",
    "GREED IS BAD",
    "LESSON LEARNED",
    "EXPENSIVE EDUCATION",
    "TUITION PAID",
    "AT LEAST I HAVE HEALTH",
    "MONEY IS FAKE ANYWAY",
    "BACK TO WENDYS",
  ],
  // Sideways/crab
  sideways: [
    "crab market",
    "zzz",
    "do something",
    "boring",
    "waiting...",
    "🦀",
    "chop chop",
    "range bound",
    "accumulating",
    "tension building",
    "*yawns*",
    "wake me up when",
    "anyone home?",
    "hello?",
    "price machine broke",
    "flat line",
    "are we stuck?",
    "sideways forever",
    "this is fine i guess",
    "...",
    "😴",
    "snooze fest",
    "paint drying vibes",
    "grass growing energy",
    "make it move",
    "come on do something",
    "poke it with a stick",
    "*taps chart*",
    "is this thing on?",
    "testing testing",
    "charts frozen?",
    "refresh?",
    "did internet die",
    "checking pulse...",
    "vital signs: meh",
    "flatline but alive",
    "in limbo",
    "purgatory",
    "the waiting game",
    "patience...",
    "any minute now",
    "surely soon",
    "copium inhaled",
    "trust the crab",
    "crab is friend",
    "sideways is accumulation",
    "whales loading quietly",
    "calm before storm",
    "spring loading",
    "coiled snake",
  ],
  // User wins
  userWin: [
    "LETS GOOO",
    "ez money",
    "called it",
    "you're cracked",
    "WINNER",
    "big brain play",
    "skill diff",
    "read like a book",
    "too easy",
    "CASH OUT 💰",
    "nice one",
    "there ya go",
    "thats the one",
    "good read",
    "well played",
    "smart money",
    "you saw it",
    "calculated",
    "as expected",
    "routine",
    "another one",
    "stacking wins",
    "keep going",
    "momentum",
    "on a roll",
    "feeling it",
    "in the zone",
    "locked in",
    "cant miss rn",
    "youre HIM",
    "different gravy",
    "galaxy brain",
    "5head play",
    "outplayed the algo",
  ],
  // User wins big (high multiplier)
  userBigWin: [
    "HOLY SHIT",
    "WHALE ALERT 🐋",
    "ABSOLUTELY MENTAL",
    "RETIRING TODAY",
    "INSANE HIT",
    "GOD GAMER",
    "THE PROPHET",
    "SCREENSHOT THIS",
    "NEW HIGH SCORE??",
    "LEGENDARY",
    "WHAT WAS THAT",
    "DID THAT JUST HAPPEN",
    "NO WAY",
    "IMPOSSIBLE",
    "HACKER??",
    "REPORTED",
    "THATS ILLEGAL",
    "ARREST THIS MAN",
    "TOO GOOD",
    "ACTUALLY INSANE",
    "CLIP THAT",
    "SEND TO FRIENDS",
    "TWITTER THIS",
    "FLEXING RIGHTS EARNED",
    "BRAGGING ALLOWED",
    "PRINT THAT",
    "FRAME IT",
    "TELL YOUR KIDS",
    "HISTORY MADE",
    "WITNESSED GREATNESS",
    "BUILT DIFFERENT",
    "NOT HUMAN",
    "AI TRADER??",
    "FUTURE VISION",
  ],
  // User loses
  userLoss: [
    "rip",
    "oof",
    "next time",
    "unlucky",
    "pain",
    "that hurt",
    "ngmi",
    "F",
    "brutal",
    "it happens",
    "unfortunate",
    "sadge",
    "copium needed",
    "inhale copium",
    "its ok",
    "shake it off",
    "forget that one",
    "on to the next",
    "variance",
    "part of the game",
    "cant win em all",
    "lesson learned",
    "data point",
    "information",
    "noted",
    "adjusting...",
    "recalibrating",
    "new strat incoming",
    "adapting",
    "learning experience",
    "tuition",
    "expensive but ok",
    "worth the education",
  ],
  // User loses big (lost a lot)
  userBigLoss: [
    "REKT",
    "DESTROYED",
    "call the ambulance",
    "thoughts & prayers",
    "WASTED",
    "emotional damage",
    "back to fiat mining",
    "liquidated irl",
    "should've hedged",
    "GUH",
    "DEVASTATING",
    "ANNIHILATED",
    "OBLITERATED",
    "VAPORIZED",
    "GONE REDUCED TO ATOMS",
    "THANOS SNAPPED",
    "DELETE THIS",
    "PRETEND IT DIDNT HAPPEN",
    "MEMORY ERASED",
    "WHAT LOSS?",
    "UNREALIZED",
    "PAPER LOSS",
    "NOT REAL",
    "SIMULATION",
    "WAKE UP",
    "ITS JUST A GAME",
    "jk... unless?",
    "haha... pain",
    "internally screaming",
    "externally calm",
    "this is fine",
    "everything is fine",
    "totally fine",
    "absolutely fine",
  ],
  // Near miss (almost won)
  nearMiss: [
    "SO CLOSE",
    "by a hair",
    "JUST missed it",
    "that was tight",
    "unlucky timing",
    "robbed",
    "one tick away",
    "pain. so much pain",
    "the tease",
    "almost had it",
    "INCHES",
    "CENTIMETERS",
    "NANOMETERS",
    "a whisker",
    "a breath",
    "SO UNLUCKY",
    "rigged??",
    "jk not rigged",
    "but like... maybe?",
    "nah variance",
    "pure bad luck",
    "next one for sure",
    "its coming",
    "due a win",
    "law of averages",
    "regression incoming",
    "justice will come",
    "karma loading",
    "universe owes you",
    "the bounce back",
    "redemption arc",
    "comeback szn",
  ],
  // Close call (barely won)
  closeCall: [
    "CLUTCH",
    "by a pixel",
    "sweaty palms",
    "heart attack",
    "squeezed through",
    "BARELY",
    "thread the needle",
    "living dangerous",
    "calculated risk 😅",
    "don't do that again",
    "TOO CLOSE",
    "CARDIAC ARREST",
    "HEART STOPPED",
    "UNCLENCHING",
    "CAN BREATHE NOW",
    "STRESS WIN",
    "ANXIETY WIN",
    "CORTISOL SPIKE",
    "ADRENALINE RUSH",
    "THAT WAS SCARY",
    "but a wins a win",
    "ill take it",
    "not complaining",
    "still counts",
    "W is W",
    "ugly but effective",
    "function over form",
    "result oriented",
    "outcome > process",
    "jk process matters",
    "got lucky ngl",
    "wont happen again",
    "learning moment",
  ],
  // Streak - multiple wins
  winStreak: [
    "ON FIRE 🔥",
    "can't miss",
    "he's gaming",
    "unstoppable",
    "STREAK",
    "hot hand",
    "the zone",
    "literally printing",
    "goated",
    "different breed",
    "NUCLEAR",
    "SUPERNOVA",
    "TRANSCENDENT",
    "ASCENDED",
    "FINAL FORM",
    "ULTRA INSTINCT",
    "AVATAR STATE",
    "SAGE MODE",
    "BANKAI",
    "PLUS ULTRA",
    "GIGACHAD",
    "SIGMA GRINDSET",
    "BUILT DIFFERENT",
    "NOT FROM HERE",
    "ALIEN DNA",
    "CHEAT CODES",
    "AIMBOT",
    "WALLHACKS",
    "SCRIPTING",
    "ACTUALLY HACKING",
    "REPORT SENT",
    "jk keep going",
    "dont stop now",
    "ride the wave",
  ],
  // Streak - multiple losses
  lossStreak: [
    "take a break?",
    "rough patch",
    "variance",
    "stay strong",
    "it'll turn",
    "darkest before dawn",
    "character building",
    "humbling experience",
    "down bad",
    "gambler's fallacy?",
    "its just variance",
    "sample size",
    "long term thinking",
    "zoom out (temporally)",
    "this too shall pass",
    "storms dont last",
    "after rain comes sun",
    "spring follows winter",
    "phoenix rising soon",
    "comeback loading",
    "redemption arc incoming",
    "main character moment",
    "the underdog story",
    "they doubted him",
    "wrote him off",
    "but he persisted",
    "never gave up",
    "kept grinding",
    "one day at a time",
    "breathe",
    "its ok fren",
    "we're all gonna make it",
    "eventually",
    "probably",
    "maybe",
    "hopium",
  ],
};

// Crypto fun facts for consolidation periods
const CRYPTO_FUN_FACTS = [
  "first btc pizza: 10,000 BTC",
  "satoshi has ~1M btc",
  "eth was $0.30 at ICO",
  "21M btc max supply",
  "btc mining uses more power than finland",
  "lost btc: ~4 million",
  "first altcoin: namecoin (2011)",
  "vitalik was 19 when eth launched",
  "sol does 65k tps",
  "btc block time: 10 min",
  "eth block time: 12 sec",
  "nakamoto = 'central intelligence' in japanese",
  "btc code has a newspaper headline",
  "the genesis block cant be spent",
  "hal finney got first btc transaction",
  "crypto market cap peaked at $3T",
  "defi TVL peaked at $180B",
  "first nft sold for $69M",
  "most expensive ENS: $2M",
  "coinbase ipo: $86B valuation",
  "mt gox lost 850k btc",
  "quadriga: $190M lost forever",
  "celsius: $4.7B frozen",
  "ftx: $8B missing",
  "luna crash: $60B gone in days",
  "btc difficulty adjusts every 2016 blocks",
  "eth burns fees since EIP-1559",
  "solana has 400ms block times",
  "avalanche has 3 chains",
  "polygon was called matic",
  "chainlink started in 2017",
  "uniswap v1: nov 2018",
  "compound invented yield farming",
  "yearn started defi summer",
  "sushi vampire attacked uni",
  "olympus invented (3,3)",
  "terra invented algorithmic stables",
  "lido has most staked eth",
  "blur flipped opensea",
  "pudgy penguins: walmart deal",
  "bayc floor was 0.08 eth",
  "cryptopunks: free mint",
  "first dao hack: $60M",
  "tornado cash dev arrested",
  "sec sued ripple for 3 years",
  "grayscale won vs sec",
  "btc etf: jan 2024",
  "blackrock has billions in btc",
  "michael saylor: 200k+ btc",
  "el salvador: btc legal tender",
  // Euphoria community facts
  "LEXAPRO is a max extractor",
  "JACK DUVAL is really 350 lbs",
  "oSKNYo_Dev has a 90% bond rate",
  "Austin a Chad",
];

// Track recently used messages to avoid repeats
const recentMessagesRef: string[] = [];
const MAX_RECENT_MESSAGES = 30;

function pickRandomMessage(category: keyof typeof CHAT_MESSAGES): string {
  const messages = CHAT_MESSAGES[category];
  
  // Filter out recently used messages
  const availableMessages = messages.filter(m => !recentMessagesRef.includes(m));
  
  // If all messages used recently, clear history and use all
  const pool = availableMessages.length > 0 ? availableMessages : messages;
  
  const selected = pool[Math.floor(Math.random() * pool.length)];
  
  // Track this message
  recentMessagesRef.push(selected);
  if (recentMessagesRef.length > MAX_RECENT_MESSAGES) {
    recentMessagesRef.shift();
  }
  
  return selected;
}

function pickRandomFunFact(): string {
  const availableFacts = CRYPTO_FUN_FACTS.filter(f => !recentMessagesRef.includes(f));
  const pool = availableFacts.length > 0 ? availableFacts : CRYPTO_FUN_FACTS;
  
  const selected = pool[Math.floor(Math.random() * pool.length)];
  recentMessagesRef.push(selected);
  if (recentMessagesRef.length > MAX_RECENT_MESSAGES) {
    recentMessagesRef.shift();
  }
  
  return "fun fact: " + selected;
}

// Track win/loss streaks for chat
let consecutiveWins = 0;
let consecutiveLosses = 0;

// Track price movement state for smarter chat
let priceWasFlat = false;
let flatStartTime = 0;

interface UseGameEngineOptions {
  isMobile: boolean;
  balance: number;
  betAmount: number;
  sessionId: string;  // Game session ID for bet tracking
  isAuthenticated: boolean;  // Whether user is authenticated
  walletAddress?: string | null;  // Wallet address for socket identification
  isAutoPlaying?: boolean;  // Auto-play mode (infinite gems, no balance changes)
  sidebarWidth?: number;  // Width of left sidebar to offset canvas
  onBalanceChange: (newBalance: number) => void;  // Server-provided balance updates only
  onWin: (winInfo: WinInfo) => void;
  onTotalWonChange: (updater: (prev: number) => number) => void;
  onTotalLostChange: (updater: (prev: number) => number) => void;
  onError?: (error: string) => void;  // Error callback for bet failures
}

interface UseGameEngineReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  configLoaded: boolean; // True when server config received - game ready to render
  volatilityLevel: VolatilityLevel;
  handlePointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: () => void;
  handlePointerLeave: () => void;
  isDragging: boolean;
  updatePrice: (price: number | null) => void;
  pendingBetsCount: number;
  zoomLevel: number;
  zoomIndex: number;
  cycleZoom: () => void;
  zoomLocked: boolean; // True when zoom is disabled due to active bets
  placeBetAt: (screenX: number, screenY: number) => Promise<boolean>; // For auto-play
  serverConfig: ServerConfig | null; // Expose server config to parent
}

export function useGameEngine({
  isMobile,
  balance,
  betAmount,
  sessionId,
  isAuthenticated,
  walletAddress,
  isAutoPlaying = false,
  sidebarWidth = 56,
  onBalanceChange,
  onWin,
  onTotalWonChange,
  onTotalLostChange,
  onError,
}: UseGameEngineOptions): UseGameEngineReturn {
  // Server config - SINGLE SOURCE OF TRUTH for game settings
  // Starts as null - game MUST wait for server config before rendering
  const serverConfigRef = useRef<ServerConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  
  const [volatilityLevel, setVolatilityLevel] = useState<VolatilityLevel>('active');
  const [isDragging, setIsDragging] = useState(false);
  const [pendingBetsCount, setPendingBetsCount] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(0);
  // Use server config zoom levels (default to 1.0 if config not yet loaded)
  const zoomLevel = serverConfigRef.current?.zoomLevels[zoomIndex] ?? 1.0;
  
  // MOBILE: Force low risk mode (zoom index 0) - no medium/high risk on mobile
  useEffect(() => {
    if (isMobile && zoomIndex !== 0) {
      setZoomIndex(0);
    }
  }, [isMobile, zoomIndex]);
  
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const requestRef = useRef<number | null>(null);
  const basePriceRef = useRef<number | null>(null);
  const priceRef = useRef<number | null>(null);
  const balanceRef = useRef(balance);
  const betAmountRef = useRef(betAmount);
  const lastBetCellRef = useRef<string | null>(null);
  const sessionIdRef = useRef(sessionId);
  
  // Track pending bet amounts to prevent overbetting during rapid clicks
  const pendingBetAmountRef = useRef<number>(0);
  
  // DRAG MODE BATCHING: Queue bets during drag, send all at once on release
  interface QueuedBet {
    localId: string;
    columnId: string;
    yIndex: number;
    basePrice: number;
    cellSize: number;
    amount: number;
    multiplier: number;
    oddsIndex: number;
  }
  const dragBetQueueRef = useRef<QueuedBet[]>([]);
  const isDraggingRef = useRef(false);
  
  const stateRef = useRef<GameState>({
    offsetX: 0,
    priceY: 0,
    targetPriceY: 0,
    priceHistory: [],
    columns: [],
    bets: [],
    lastGenX: 0,
    cameraY: 0,
    initialized: false,
    recentPrices: [],
    currentSpeed: 1, // Will be updated when server config arrives
    lastPrice: null,
    particles: [],
    specialCells: [],
    lastSpecialCellTime: Date.now(),
    last5xCellTime: Date.now(),
  });
  
  // ========== SOCKET CONNECTION FOR SERVER-AUTHORITATIVE GAME ==========
  // Handles: game state, heatmap, bet resolution, balance updates
  const socketRef = useRef<Socket | null>(null);
  const heatmapRef = useRef<Map<string, HeatmapCell>>(new Map());
  const serverBetsRef = useRef<ServerBetData[]>([]);
  
  // Helper to get server config - returns null if not yet received
  // All game logic MUST check this before using
  const getConfig = useCallback(() => serverConfigRef.current, []);
  
  // Server state for interpolation - client smoothly moves towards these targets
  const serverStateRef = useRef<{
    targetPriceY: number;
    targetOffsetX: number;
    lastUpdate: number;
  }>({
    targetPriceY: 0,
    targetOffsetX: 0,
    lastUpdate: 0,
  });
  
  // Track wallet address for identifying our bets
  const walletAddressRef = useRef<string | null>(null);
  
  // Store callbacks in refs for socket handlers
  const onBalanceChangeRef = useRef(onBalanceChange);
  const onWinRef = useRef(onWin);
  const onTotalWonChangeRef = useRef(onTotalWonChange);
  const onTotalLostChangeRef = useRef(onTotalLostChange);
  
  useEffect(() => {
    onBalanceChangeRef.current = onBalanceChange;
    onWinRef.current = onWin;
    onTotalWonChangeRef.current = onTotalWonChange;
    onTotalLostChangeRef.current = onTotalLostChange;
  }, [onBalanceChange, onWin, onTotalWonChange, onTotalLostChange]);
  
  // Connect to socket for server-authoritative game
  useEffect(() => {
    const socket = io(GAME_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log('[GameEngine] Connected to game server (server-authoritative mode)');
      
      // Identify wallet for authenticated bet placement
      if (walletAddress) {
        socket.emit('identify', { walletAddress });
        console.log('[GameEngine] Identified wallet:', walletAddress.slice(0, 8));
      }
    });
    
    // Receive server config (SINGLE SOURCE OF TRUTH)
    // Game CANNOT function without this - must wait
    socket.on('serverConfig', (config: ServerConfig) => {
      console.log('[GameEngine] Received server config - game ready');
      serverConfigRef.current = config;
      setConfigLoaded(true);
    });
    
    // ========== RECEIVE AUTHORITATIVE GAME STATE FROM SERVER ==========
    // Server is the single source of truth - client just renders
    socket.on('gameState', (serverState: { 
      priceY: number;
      targetPriceY: number;
      offsetX: number;
      currentPrice: number | null;
      priceHistory: Array<{ x: number; y: number }>;
      columns: Array<{ id: string; x: number; cells: Record<number, { id: string; multiplier: string }> }>;
      bets: ServerBetData[];
      heatmap?: HeatmapCell[];
      gridSpeed: number;
      volatility: 'active' | 'low' | 'idle';
      serverTime: number;
    }) => {
      const state = stateRef.current;
      
      // Store server targets for smooth interpolation
      serverStateRef.current = {
        targetPriceY: serverState.priceY, // Server's current priceY is our target
        targetOffsetX: serverState.offsetX,
        lastUpdate: Date.now(),
      };
      
      // Update price from server
      if (serverState.currentPrice !== null) {
        priceRef.current = serverState.currentPrice;
        if (basePriceRef.current === null) {
          basePriceRef.current = serverState.currentPrice;
        }
      }
      
      // Update price history from server (authoritative)
      state.priceHistory = serverState.priceHistory;
      
      // Update volatility
      if (serverState.volatility) {
        setVolatilityLevel(serverState.volatility);
      }
      state.currentSpeed = serverState.gridSpeed;
      
      // Update heatmap lookup
      if (serverState.heatmap) {
        const newHeatmap = new Map<string, HeatmapCell>();
        for (const cell of serverState.heatmap) {
          newHeatmap.set(`${cell.colId}-${cell.yIndex}`, cell);
        }
        heatmapRef.current = newHeatmap;
      }
      
      // Track server bets (from other players)
      if (serverState.bets) {
        serverBetsRef.current = serverState.bets;
      }
      
      // Mark as initialized once we receive first server state
      if (!state.initialized) {
        state.initialized = true;
        state.offsetX = serverState.offsetX;
        state.priceY = serverState.priceY;
        state.targetPriceY = serverState.priceY;
      }
    });
    
    // When another player places a bet, it shows on our heatmap via gameState updates
    socket.on('betPlaced', (bet: ServerBetData) => {
      console.log('[GameEngine] Bet placed by', bet.walletAddress?.slice(0, 8));
    });
    
    // ========== SERVER CONFIRMATION OF BET RESOLUTION ==========
    // Client resolves optimistically, server confirms or corrects
    socket.on('betResolved', (data: {
      bet: { id: string; colId: string; yIndex: number; wager: number; payout: number; walletAddress: string; status: string };
      won: boolean;
      dbBetId?: string;
      actualWin?: number;
      newBalance?: number;
    }) => {
      console.log('[GameEngine] Server confirmed bet:', data.bet.id, data.won ? 'WON' : 'LOST', 'dbBetId:', data.dbBetId);
      
      // Find our local bet that matches this server bet
      // Match by serverId (database bet ID) if available
      const state = stateRef.current;
      let localBet = data.dbBetId 
        ? state.bets.find(b => b.serverId === data.dbBetId)
        : null;
      
      // Fallback: match by yIndex and amount for recently resolved bets
      if (!localBet) {
        localBet = state.bets.find(b => 
          b.yIndex === data.bet.yIndex &&
          b.amount === data.bet.wager &&
          (b.status === 'pending' || b.status === 'placing' || b.status === 'won' || b.status === 'lost')
        );
      }
      
      if (!localBet) {
        console.log('[GameEngine] No matching local bet found for server resolution');
        return;
      }
      
      const wasAlreadyResolved = localBet.status === 'won' || localBet.status === 'lost';
      const previousStatus = localBet.status;
      const serverWon = data.won;
      
      // Check if server disagrees with our optimistic resolution
      if (wasAlreadyResolved) {
        const localWon = previousStatus === 'won';
        
        if (localWon !== serverWon) {
          console.warn('[GameEngine] Server correction needed:', { localSaid: previousStatus, serverSays: serverWon ? 'won' : 'lost' });
          
          // Correct the bet status
          localBet.status = serverWon ? 'won' : 'lost';
          
          // Correct the stats
          const autoPlaying = isAutoPlayingRef.current;
          if (!autoPlaying) {
            if (serverWon && !localWon) {
              // We thought loss, server says win - add winnings back
              const winAmount = data.actualWin || localBet.amount * localBet.multiplier;
              balanceRef.current += winAmount;
              onBalanceChangeRef.current(balanceRef.current);
              onTotalWonChangeRef.current(prev => prev + winAmount - localBet.amount);
              onTotalLostChangeRef.current(prev => prev - localBet.amount);
            } else if (!serverWon && localWon) {
              // We thought win, server says loss - remove winnings
              const expectedWin = localBet.amount * localBet.multiplier;
              balanceRef.current -= expectedWin;
              onBalanceChangeRef.current(balanceRef.current);
              onTotalWonChangeRef.current(prev => prev - expectedWin + localBet.amount);
              onTotalLostChangeRef.current(prev => prev + localBet.amount);
            }
          }
        }
        // If server agrees with us, no action needed - optimistic resolution was correct
      } else {
        // Bet wasn't resolved yet (shouldn't happen with optimistic, but handle it)
        localBet.status = serverWon ? 'won' : 'lost';
        const autoPlaying = isAutoPlayingRef.current;
        const sounds = getGameSounds();
        
        if (serverWon) {
          const winAmount = data.actualWin || localBet.amount * localBet.multiplier;
          sounds.play('win');
          
          if (!autoPlaying) {
            balanceRef.current += winAmount;
            onBalanceChangeRef.current(balanceRef.current);
            onTotalWonChangeRef.current(prev => prev + winAmount - localBet.amount);
          }
        } else {
          sounds.play('loss');
          if (!autoPlaying) {
            onTotalLostChangeRef.current(prev => prev + localBet.amount);
          }
        }
        
        setPendingBetsCount(prev => Math.max(0, prev - 1));
      }
      
      // Sync balance with server if provided (authoritative)
      if (data.newBalance !== undefined && !isAutoPlayingRef.current) {
        balanceRef.current = data.newBalance;
        onBalanceChangeRef.current(data.newBalance);
      }
    });
    
    // Balance update from server (authoritative)
    socket.on('balanceUpdate', (data: { newBalance: number; reason: string }) => {
      console.log('[GameEngine] Balance update from server:', data.newBalance, data.reason);
      onBalanceChangeRef.current(data.newBalance);
      balanceRef.current = data.newBalance;
    });
    
    return () => {
      socket.disconnect();
    };
  }, [isMobile, zoomLevel, walletAddress]);
  
  // Track tab visibility to handle price jumps smoothly
  const lastFrameTimeRef = useRef<number>(Date.now());
  
  // DELTA TIME NORMALIZATION: Track time for frame-independent physics
  // Target 60fps (16.67ms per frame) as baseline
  const TARGET_FRAME_MS = 1000 / 60;
  
  // Hover and animation state
  const hoverCellRef = useRef<{ colId: string; yIndex: number } | null>(null);
  const mouseWorldPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // Chat bubble state for price action personality
  const chatBubbleRef = useRef<ChatBubble | null>(null);
  const lastChatTimeRef = useRef<number>(0);
  const lastFunFactTimeRef = useRef<number>(0); // Separate cooldown for fun facts
  const priceMovementTrackerRef = useRef<{ price: number; time: number }[]>([]);
  const CHAT_COOLDOWN = 3000; // Minimum 3 seconds between messages
  const FUN_FACT_COOLDOWN = 45000; // Minimum 45 seconds between fun facts
  const CHAT_DURATION = 2500; // How long each message shows
  
  // Win animation particles (reserved for future animation enhancements)
  // interface WinParticle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
  // const winParticlesRef = useRef<WinParticle[]>([]);
  // interface WinPulse { x: number; y: number; radius: number; maxRadius: number; alpha: number; }
  // const winPulsesRef = useRef<WinPulse[]>([]);

  // Keep refs in sync
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { betAmountRef.current = betAmount; }, [betAmount]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  
  // Update pending bets count
  useEffect(() => {
    const count = stateRef.current.bets.filter(b => b.status === 'pending' || b.status === 'placing').length;
    setPendingBetsCount(count);
  }, []);
  
  // Track previous zoom index to detect actual changes (not initial mount)
  const prevZoomIndexRef = useRef<number | null>(null);
  
  // REDRAW ENTIRE GRID when zoom changes (but NOT on initial mount)
  useEffect(() => {
    // Skip on initial mount - let the main initialization handle it
    if (prevZoomIndexRef.current === null) {
      prevZoomIndexRef.current = zoomIndex;
      return;
    }
    
    // Only run if zoom actually changed
    if (prevZoomIndexRef.current === zoomIndex) return;
    prevZoomIndexRef.current = zoomIndex;
    
    const state = stateRef.current;
    const cfg = serverConfigRef.current;
    if (!state.initialized || !cfg) return; // Wait for config
    
    const cellSize = Math.floor((isMobile ? cfg.cellSizeMobile : cfg.cellSize) * zoomLevel);
    const headX = isMobile ? cfg.headXMobile : cfg.headX;
    
    // Clear columns and reset grid
    state.columns = [];
    state.lastGenX = 0;
    state.offsetX = 0;
    state.priceY = cellSize / 2;
    state.targetPriceY = cellSize / 2;
    state.priceHistory = [{ x: headX, y: cellSize / 2 }];
    // Use virtual height for camera (accounts for mobile zoom-out)
    const initCameraScale = isMobile ? cfg.mobileCameraScale : 1;
    state.cameraY = (window.innerHeight / initCameraScale) / 2;
    
    // Regenerate columns with proper cells using generateColumn pattern
    // Large buffer for high volatility movement
    const priceY = cellSize / 2;
    const zoomBufferCols = (isMobile ? cfg.minBetColumnsAheadMobile : cfg.minBetColumnsAhead) + 30;
    for (let x = 0; x < window.innerWidth + cellSize * zoomBufferCols; x += cellSize) {
      const centerYIndex = Math.floor(priceY / cellSize);
      const newCol: Column = {
        id: Math.random().toString(36).substr(2, 9),
        x,
        cells: {},
        centerIndex: centerYIndex,
      };
      
      // Populate cells around center (same pattern as generateColumn)
      for (let j = -15; j <= 15; j++) {
        const yIndex = centerYIndex + j;
        newCol.cells[yIndex] = {
          id: Math.random().toString(36).substr(2, 9),
          multiplier: '1.10', // Placeholder - actual multiplier calculated dynamically during render
        };
      }
      
      state.columns.push(newCol);
      state.lastGenX = x;
    }
    
    console.log('[Zoom] Grid redrawn at zoom level', zoomLevel);
  }, [zoomIndex, isMobile, zoomLevel]);

  // Get responsive config values with zoom applied
  // These return sensible defaults if config not yet loaded
  const getCellSize = useCallback(() => {
    const cfg = serverConfigRef.current;
    if (!cfg) return 50; // Default until config loads
    const baseSize = isMobile ? cfg.cellSizeMobile : cfg.cellSize;
    return Math.floor(baseSize * zoomLevel);
  }, [isMobile, zoomLevel]);
  const getHeadX = useCallback(() => {
    const cfg = serverConfigRef.current;
    if (!cfg) return isMobile ? 60 : 450;
    return isMobile ? cfg.headXMobile : cfg.headX;
  }, [isMobile]);
  // Price axis hidden on mobile for more game space
  const getPriceAxisWidth = useCallback(() => {
    const cfg = serverConfigRef.current;
    if (!cfg) return isMobile ? 0 : 80;
    return isMobile ? 0 : cfg.priceAxisWidth;
  }, [isMobile]);
  const getMinBetColumnsAhead = useCallback(() => {
    const cfg = serverConfigRef.current;
    if (!cfg) return isMobile ? 5 : 8;
    return isMobile ? cfg.minBetColumnsAheadMobile : cfg.minBetColumnsAhead;
  }, [isMobile]);

  const generateColumn = useCallback((xPosition: number, currentPriceY: number) => {
    const state = stateRef.current;
    const cfg = serverConfigRef.current;
    if (!cfg) return; // Config not loaded yet
    
    const cellSize = getCellSize();
    const currentPriceIndex = Math.floor((currentPriceY + cellSize / 2) / cellSize);
    
    const cells: Record<number, { id: string; multiplier: string }> = {};
    for (let i = -cfg.verticalCells; i <= cfg.verticalCells; i++) {
      const yIndex = currentPriceIndex + i;
      cells[yIndex] = {
        id: Math.random().toString(36).substr(2, 9),
        multiplier: calculateMultiplier(yIndex, currentPriceIndex, zoomLevel),
      };
    }

    state.columns.push({
      id: Math.random().toString(36).substr(2, 9),
      x: xPosition,
      cells,
      centerIndex: currentPriceIndex,
    });
    
    // Clean up old columns, but NEVER remove columns that have pending bets
    if (state.columns.length > 100) {
      // Find first column that can be safely removed (no pending bets on it)
      const indexToRemove = state.columns.findIndex(col => {
        const hasPendingBet = state.bets.some(
          bet => bet.colId === col.id && (bet.status === 'pending' || bet.status === 'placing')
        );
        return !hasPendingBet;
      });
      
      if (indexToRemove !== -1 && indexToRemove < state.columns.length - 50) {
        // Only remove if it's not one of the recent columns
        state.columns.splice(indexToRemove, 1);
      }
    }
    
    state.lastGenX = xPosition;
  }, [getCellSize, zoomLevel]);

  const playSound = useCallback((type: 'win' | 'click' | 'lose') => {
    const sounds = getGameSounds();
    switch (type) {
      case 'win':
        sounds.play('win');
        break;
      case 'click':
        sounds.play('bet');
        break;
      case 'lose':
        sounds.play('loss');
        break;
    }
  }, []);

  // Track auto-play state in ref for callbacks
  const isAutoPlayingRef = useRef(isAutoPlaying);
  useEffect(() => {
    isAutoPlayingRef.current = isAutoPlaying;
  }, [isAutoPlaying]);

  const placeBetAt = useCallback(async (screenX: number, screenY: number, allowDuplicate = false) => {
    const cfg = serverConfigRef.current;
    if (!cfg) return false; // Config not loaded yet
    
    const currentBalance = balanceRef.current;
    const currentBetAmount = betAmountRef.current;
    const cellSize = getCellSize();
    const headX = getHeadX();
    const priceAxisWidth = getPriceAxisWidth();
    const autoPlaying = isAutoPlayingRef.current;
    
    // Client-side pre-check (skip if auto-playing - infinite gems)
    if (!autoPlaying && currentBalance < currentBetAmount) {
      onError?.('Insufficient balance');
      return false;
    }
    // Use canvas width (already accounts for sidebar) and scale it for mobile camera zoom
    const cameraScale = isMobile ? cfg.mobileCameraScale : 1;
    const virtualWidth = (canvasRef.current?.width ?? window.innerWidth) / cameraScale;
    if (screenX > virtualWidth - priceAxisWidth) return false;
    
    const state = stateRef.current;
    const worldX = screenX + state.offsetX;
    const worldY = screenY - state.cameraY;
    
    const clickedCol = state.columns.find(c => worldX >= c.x && worldX < c.x + cellSize);
    
    if (clickedCol) {
      const yIndex = Math.floor(worldY / cellSize);
      
      // Validate yIndex is reasonable (prevent negative/extreme values)
      const MAX_Y_INDEX = 100;
      const MIN_Y_INDEX = -100;
      if (yIndex < MIN_Y_INDEX || yIndex > MAX_Y_INDEX) {
        // Only log warning for invalid values (rare case)
        console.warn('[BET] Invalid yIndex:', yIndex, { screenY, cameraY: state.cameraY, worldY });
        return false;
      }
      
      const minBetX = state.offsetX + headX + cellSize * getMinBetColumnsAhead();
      
      if (clickedCol.x > minBetX) {
        const cellKey = `${clickedCol.id}-${yIndex}`;
        if (!allowDuplicate && lastBetCellRef.current === cellKey) {
          return false;
        }
        
        // Check for existing bet at this location
        const existingBet = state.bets.find(
          b => b.colId === clickedCol.id && b.yIndex === yIndex && 
               (b.status === 'pending' || b.status === 'placing')
        );
        if (existingBet) return false;
        
        lastBetCellRef.current = cellKey;
        playSound('click');
        
        // Ensure cell exists in column
        let cell = clickedCol.cells[yIndex];
        if (!cell) {
          cell = {
            id: Math.random().toString(36).substr(2, 9),
            multiplier: '1.10', // Placeholder - actual multiplier calculated dynamically
          };
          clickedCol.cells[yIndex] = cell;
        }

        // DYNAMIC MULTIPLIER: Calculate based on CURRENT price position at time of bet
        // Note: priceY is the Y coordinate of the price line, cellSize is the cell height
        // To find which cell index the price is in: floor(priceY / cellSize)
        const currentPriceYIndex = Math.floor(stateRef.current.priceY / cellSize);
        const dynamicMultiplier = calculateMultiplier(yIndex, currentPriceYIndex, zoomLevel);
        let multiplier = parseFloat(dynamicMultiplier);
        const localBetId = Math.random().toString(36).substr(2, 9);
        
        // 🌟 CHECK FOR SPECIAL CELL - Apply 2x bonus!
        if (!state.specialCells) state.specialCells = [];
        const specialCell = state.specialCells.find(sc => sc.colId === clickedCol.id && sc.yIndex === yIndex);
        let isSpecialBet = false;
        if (specialCell) {
          multiplier *= specialCell.bonusMultiplier;
          isSpecialBet = true;
          // Remove the special cell once a bet is placed on it
          state.specialCells = state.specialCells.filter(sc => sc.id !== specialCell.id);
          console.log(`[Special Cell] ${specialCell.bonusMultiplier}X BONUS applied! New multiplier:`, multiplier);
        }
        
        // IMMEDIATE WIN ZONE CALCULATION - same formula as server
        // This enables instant win zone rendering without waiting for server
        const basePrice = basePriceRef.current ?? 0;
        const cellYTop = yIndex * cellSize;
        const cellYBottom = (yIndex + 1) * cellSize;
        const winPriceMax = basePrice + (cellSize / 2 - cellYTop) / cfg.priceScale;
        const winPriceMin = basePrice + (cellSize / 2 - cellYBottom) / cfg.priceScale;
        
        // Create bet - demo mode goes straight to pending, authenticated waits for server
        // Store basePriceAtBet AND win boundaries for immediate visualization
        const newBet: Bet = {
          id: localBetId,
          colId: clickedCol.id,
          yIndex,
          amount: currentBetAmount,
          multiplier,
          potentialWin: currentBetAmount * multiplier,
          status: isAuthenticated ? 'placing' : 'pending',
          basePriceAtBet: basePrice,
          winPriceMin,  // Calculated immediately for instant rendering
          winPriceMax,  // Server will overwrite with authoritative values
          placedAt: Date.now(),  // For placement animation
          isSpecialBonus: isSpecialBet,  // Mark if placed on special cell
        };
        
        state.bets.push(newBet);
        setPendingBetsCount(prev => prev + 1);
        
        // Special cell sound
        if (isSpecialBet) {
          playSound('win'); // Exciting sound for special cell!
        }
        
        // IMMEDIATELY deduct balance (optimistic update for instant feedback)
        // Skip if auto-playing - infinite gems mode
        if (!autoPlaying) {
        const newBalance = currentBalance - currentBetAmount;
        balanceRef.current = newBalance;
        onBalanceChange(newBalance);
        }
        
        // DEMO MODE: Done - no server call needed
        if (!isAuthenticated) {
          return true;
        }
        
        // AUTHENTICATED: Track pending amount in case server rejects
        pendingBetAmountRef.current += currentBetAmount;
        
        // DRAG MODE BATCHING: Queue bet if dragging, send later
        // Note: basePrice already defined above for win zone calculation
        if (isDraggingRef.current) {
          dragBetQueueRef.current.push({
            localId: localBetId,
            columnId: clickedCol.x.toString(), // Use X position for server column matching
            yIndex,
            basePrice,
            cellSize,
            amount: currentBetAmount,
            multiplier,
            oddsIndex: zoomIndex,
          });
          return true; // Bet queued, will be sent on drag end
        }
        
        // SINGLE BET: Send via socket for server-authoritative placement
        const socket = socketRef.current;
        if (!socket?.connected) {
          // Socket not connected - REFUND
          const betIndex = state.bets.findIndex(b => b.id === localBetId);
          if (betIndex !== -1) {
            state.bets.splice(betIndex, 1);
          }
          pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - currentBetAmount);
          balanceRef.current += currentBetAmount;
          onBalanceChange(balanceRef.current);
          onError?.('Not connected to server');
          setPendingBetsCount(prev => Math.max(0, prev - 1));
          return false;
        }
        
        // Emit placeBet via socket
        // Send column X position and current offsetX so server can sync
        socket.emit('placeBet', {
          colId: clickedCol.x.toString(), // Use X position for server column matching
          yIndex,
          wager: currentBetAmount,
          oddsIndex: zoomIndex,
          oddsMultiplier: multiplier.toString(),
          sessionId: sessionIdRef.current,
          basePrice,
          cellSize,
          clientOffsetX: state.offsetX, // Send client's world position for server sync
          useDatabase: true,
        }, (result: { success: boolean; bet?: { id: string; priceAtBet?: number; winPriceMin?: number; winPriceMax?: number; colId?: string }; error?: string; newBalance?: number; dbBetId?: string }) => {
          if (result.success && result.bet) {
            // Update bet with server data (including win boundaries)
            const bet = state.bets.find(b => b.id === localBetId);
            if (bet) {
              bet.serverId = result.dbBetId || result.bet.id;
              bet.status = 'pending';
              bet.priceAtBet = result.bet.priceAtBet;
              // Store server-calculated win boundaries for visualization
              bet.winPriceMin = result.bet.winPriceMin;
              bet.winPriceMax = result.bet.winPriceMax;
            }
            
            // Server confirmed - clear pending tracking
            pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - currentBetAmount);
            // Balance will be synced via socket balanceUpdate events
          } else {
            // Bet REJECTED by server - REFUND the optimistic deduction
            const betIndex = state.bets.findIndex(b => b.id === localBetId);
            if (betIndex !== -1) {
              state.bets.splice(betIndex, 1);
            }
            
            // Refund: add the bet amount back
            pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - currentBetAmount);
            balanceRef.current = result.newBalance ?? balanceRef.current + currentBetAmount;
            onBalanceChange(balanceRef.current);
            
            onError?.(result.error || 'Failed to place bet');
            playSound('lose');
            setPendingBetsCount(prev => Math.max(0, prev - 1));
          }
        });
        
        // Return true optimistically - socket callback handles errors
        return true;
      }
    }
    return false;
  }, [isAuthenticated, playSound, getCellSize, getHeadX, getPriceAxisWidth, getMinBetColumnsAhead, isMobile, zoomLevel, zoomIndex, onBalanceChange, onError]);

  const updatePrice = useCallback((price: number | null) => {
    if (price !== null) {
      priceRef.current = price;
    }
  }, []);

  // Main animation loop - ONLY runs after server config is received
  useEffect(() => {
    const canvas = canvasRef.current;
    // MUST have server config before rendering - no fallbacks
    if (!canvas || !serverConfigRef.current) return;
    
    // Create local reference to config for this effect
    const config = serverConfigRef.current;

    const cellSize = getCellSize();
    const headX = getHeadX();
    const priceAxisWidth = getPriceAxisWidth();

    // SERVER-AUTHORITATIVE: Server resolves bets, client just listens
    // This function only handles DEMO mode (no serverId) for local testing
    const checkBets = async (currentHeadX: number, currentPriceY: number) => {
      const state = stateRef.current;
      
      for (const bet of state.bets) {
        // Only process pending bets that aren't already resolving
        if (bet.status !== 'pending' || bet.resolving) continue;

        const col = state.columns.find(c => c.id === bet.colId);
        if (!col) {
          // Column no longer exists - mark as waiting (server will resolve)
          if (bet.serverId) continue; // Server bets wait for server
          // Demo mode: loss
          bet.status = 'lost';
          onTotalLostChange(prev => prev + bet.amount);
          playSound('lose');
          setPendingBetsCount(prev => Math.max(0, prev - 1));
          continue;
        }

        const betEndX = col.x + cellSize;
        
        // When price line passes the bet column, resolve the bet
        if (currentHeadX > betEndX) {
          // SERVER BETS: Don't resolve here - wait for betResolved event from server
          if (bet.serverId) {
            // Just mark as resolving so we don't check again
            bet.resolving = true;
            continue;
          }
          
          // DEMO MODE ONLY: Simple cell-based resolution (matches server logic)
          // Check if current priceY is within the bet's cell (with win zone margin)
          const margin = config.winZoneMargin;
          const effectiveMin = bet.yIndex + margin;
          const effectiveMax = bet.yIndex + 1 - margin;
          const priceInCell = currentPriceY / cellSize;
          
          const isWin = priceInCell >= effectiveMin && priceInCell <= effectiveMax;
          
          bet.status = isWin ? 'won' : 'lost';
          const autoPlaying = isAutoPlayingRef.current;
          
          if (isWin) {
            consecutiveWins++;
            consecutiveLosses = 0;
            
            const winAmount = bet.amount * bet.multiplier;
            if (!autoPlaying) {
              onBalanceChange(balanceRef.current + winAmount);
              balanceRef.current += winAmount;
            }
            onTotalWonChange(prev => prev + winAmount - bet.amount);
            
            const cameraScale = isMobile ? config.mobileCameraScale : 1;
            const screenX = (col.x - state.offsetX + cellSize / 2) * cameraScale;
            const screenY = (bet.yIndex * cellSize + state.cameraY) * cameraScale;
            
            onWin({ amount: winAmount, id: bet.id, screenX, screenY });
            playSound('win');
          } else {
            consecutiveLosses++;
            consecutiveWins = 0;
            
            if (!autoPlaying) {
              onTotalLostChange(prev => prev + bet.amount);
            }
            playSound('lose');
          }
          setPendingBetsCount(prev => Math.max(0, prev - 1));
        }
      }
    };

    // NOTE: Volatility calculation is now SERVER-SIDE
    // Server determines grid speed and volatility level, sends via gameState socket

    const updatePhysics = () => {
      const state = stateRef.current;
      const width = canvas.width;
      const now = Date.now();
      const timeSinceLastFrame = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;
      
      // DELTA TIME NORMALIZATION: Calculate time factor for frame-independent physics
      // Clamp to prevent huge jumps on slow frames (max 3x normal speed)
      const deltaTime = Math.min(timeSinceLastFrame, TARGET_FRAME_MS * 3) / TARGET_FRAME_MS;

      // ========== SERVER-AUTHORITATIVE PHYSICS ==========
      // Client smoothly interpolates towards server-provided targets
      // Server is the single source of truth for all game state
      
      const serverState = serverStateRef.current;
      const hasServerData = serverState.lastUpdate > 0;
      
      if (hasServerData) {
        // SNAP offsetX to server immediately - no interpolation
        // Server's priceHistory uses server's offsetX, so we must match exactly
        state.offsetX = serverState.targetOffsetX;
        
        // priceY: smooth interpolation for nice price line movement
        const priceDiff = serverState.targetPriceY - state.priceY;
        const priceSmoothing = 1 - Math.pow(1 - config.priceSmoothing, deltaTime);
        state.priceY += priceDiff * priceSmoothing;
        state.targetPriceY = serverState.targetPriceY;
      } else {
        // No server data yet - initialize with defaults
        if (!state.initialized) {
          state.priceY = cellSize / 2;
          state.targetPriceY = cellSize / 2;
        }
      }

      // Generate columns as needed (client-side for rendering)
      const rightEdge = state.offsetX + width;
      const colBufferAhead = (isMobile ? config.minBetColumnsAheadMobile : config.minBetColumnsAhead) + 25;
      let columnsGenerated = 0;
      while (state.lastGenX < rightEdge + cellSize * colBufferAhead && columnsGenerated < 50) {
        generateColumn(state.lastGenX + cellSize, state.priceY);
        columnsGenerated++;
      }
      // NOTE: Bet avoidance (house edge) is now handled SERVER-SIDE
      // Server applies avoidance force and sends us the final priceY
      
      const currentWorldX = state.offsetX + headX;
      
      // NOTE: Price history is now provided by server - no local generation
      // Server's priceHistory is authoritative and already populated via gameState socket

      // Use virtual height for camera centering (accounts for mobile zoom-out)
      const cameraScale = isMobile ? config.mobileCameraScale : 1;
      const virtualHeight = canvas.height / cameraScale;
      const targetCameraY = -state.priceY + virtualHeight / 2;
      // TIME-NORMALIZED: Camera smoothing scaled by deltaTime
      const cameraSmoothing = 1 - Math.pow(0.98, deltaTime);
      state.cameraY += (targetCameraY - state.cameraY) * cameraSmoothing;

      const currentPrice = priceRef.current;
      if (currentPrice !== null) {
        state.lastPrice = currentPrice;
      }
      checkBets(currentWorldX, state.priceY);
      
      // === CHAT BUBBLES: Price action personality ===
      // Track price movements over time (only when we have valid price data)
      if (currentPrice !== null) {
        priceMovementTrackerRef.current.push({ price: currentPrice, time: now });
      }
      // Keep only last 2 seconds of data
      priceMovementTrackerRef.current = priceMovementTrackerRef.current.filter(p => now - p.time < 2000);
      
      // Check if we should show a new message
      const timeSinceLastChat = now - lastChatTimeRef.current;
      
      if (timeSinceLastChat > CHAT_COOLDOWN && priceMovementTrackerRef.current.length > 10) {
        const tracker = priceMovementTrackerRef.current;
        const oldPrice = tracker[0].price;
        const newPrice = tracker[tracker.length - 1].price;
        const priceChange = ((newPrice - oldPrice) / oldPrice) * 100;
        
        // Thresholds for SOL price movements (these are % over ~2 seconds)
        const isMediumMove = Math.abs(priceChange) > 0.025;
        const isFlat = Math.abs(priceChange) < 0.01;
        
        let category: keyof typeof CHAT_MESSAGES | null = null;
        let message: string | null = null;
        let shouldSpeak = false;
        
        // Track if we're seeing movement
        if (isMediumMove) {
          priceWasFlat = false;
          flatStartTime = 0;
        } else if (isFlat && !priceWasFlat) {
          priceWasFlat = true;
          flatStartTime = now;
        }
        
        const timeBeenFlat = priceWasFlat && flatStartTime > 0 ? now - flatStartTime : 0;
        
        // BIG MOVES - high chance to comment
        if (priceChange > 0.08) {
          if (Math.random() < 0.6) { // 60% chance
            category = 'bigUp';
            shouldSpeak = true;
          }
        } else if (priceChange < -0.08) {
          if (Math.random() < 0.6) {
            category = 'bigDown';
            shouldSpeak = true;
          }
        }
        // MEDIUM MOVES - moderate chance
        else if (priceChange > 0.025) {
          if (Math.random() < 0.12) { // 12% chance
            category = 'smallUp';
            shouldSpeak = true;
          }
        } else if (priceChange < -0.025) {
          if (Math.random() < 0.12) {
            category = 'smallDown';
            shouldSpeak = true;
          }
        }
        // SIDEWAYS - only after being flat for 6+ seconds, low chance
        else if (isFlat && timeBeenFlat > 6000 && timeBeenFlat < 20000) {
          if (Math.random() < 0.03) { // 3% chance
            category = 'sideways';
            shouldSpeak = true;
          }
        }
        // FUN FACTS - only after 20+ seconds flat, very low chance, separate longer cooldown
        else if (isFlat && timeBeenFlat > 20000 && (now - lastFunFactTimeRef.current > FUN_FACT_COOLDOWN)) {
          if (Math.random() < 0.01) { // 1% chance (reduced from 2%)
            message = pickRandomFunFact();
            shouldSpeak = true;
            lastFunFactTimeRef.current = now; // Update fun fact specific cooldown
          }
        }
        
        if (shouldSpeak && (category || message)) {
          chatBubbleRef.current = {
            message: message || pickRandomMessage(category!),
            startTime: now,
            duration: message ? 3500 : CHAT_DURATION,
          };
          lastChatTimeRef.current = now;
        }
      }
      
      // Clear expired chat bubbles
      if (chatBubbleRef.current && now - chatBubbleRef.current.startTime > chatBubbleRef.current.duration) {
        chatBubbleRef.current = null;
      }
      
      // Particles disabled for performance
      // if (state.particles && state.particles.length > 0) {
      //   state.particles = updateParticles(state.particles, deltaTime);
      // }
      
      // === SPECIAL CELLS: 2X every 30 seconds, 5X every 90 seconds (separate timers!) ===
      const SPECIAL_CELL_INTERVAL_2X = 30000; // 30 seconds for 2x
      const SPECIAL_CELL_INTERVAL_5X = 90000; // 90 seconds for 5x
      const timeSinceLastSpecial = now - state.lastSpecialCellTime;
      const timeSinceLast5x = now - (state.last5xCellTime || 0);
      
      // 5x spawns on its own timer (every 90 seconds, 25% chance)
      const shouldTry5x = timeSinceLast5x >= SPECIAL_CELL_INTERVAL_5X && Math.random() < 0.25;
      // 2x spawns on its own timer (every 30 seconds) - independent of 5x
      const shouldTry2x = !shouldTry5x && timeSinceLastSpecial >= SPECIAL_CELL_INTERVAL_2X;
      
      if ((shouldTry5x || shouldTry2x) && state.columns.length > 0) {
        const is5xBonus = shouldTry5x;
        
        // 5x spawns further out and further from center (harder to hit!)
        const columnsAhead = is5xBonus 
          ? (20 + Math.random() * 15) // 20-35 columns ahead for 5x
          : (15 + Math.random() * 10); // 15-25 columns ahead for 2x
        const targetX = state.offsetX + headX + cellSize * columnsAhead;
        const targetCol = state.columns.find(c => c.x >= targetX);
        
        if (targetCol) {
          // Place it far from center - 5x is even further out!
          const currentCenterY = Math.floor(state.priceY / cellSize);
          const offsetDirection = Math.random() > 0.5 ? 1 : -1;
          const offsetAmount = is5xBonus 
            ? (6 + Math.floor(Math.random() * 6)) // 6-11 cells away for 5x (very hard!)
            : (4 + Math.floor(Math.random() * 5)); // 4-8 cells away for 2x
          const specialYIndex = currentCenterY + offsetDirection * offsetAmount;
          
          // Create special cell
          const specialCell: SpecialCell = {
            id: `special-${Date.now()}`,
            colId: targetCol.id,
            yIndex: specialYIndex,
            createdAt: now,
            bonusMultiplier: is5xBonus ? 5.0 : 2.0,
          };
          
          if (!state.specialCells) state.specialCells = [];
          state.specialCells.push(specialCell);
          
          // Update the appropriate timer
          if (is5xBonus) {
            state.last5xCellTime = now;
          } else {
            state.lastSpecialCellTime = now;
          }
          
          console.log(`[Special Cell] ${is5xBonus ? '⭐5X⭐' : '2X'} Created at column`, targetCol.id, 'yIndex', specialYIndex);
        }
      }
      
      // Clean up old special cells that have passed
      if (state.specialCells && state.specialCells.length > 0) {
        state.specialCells = state.specialCells.filter(sc => {
          const col = state.columns.find(c => c.id === sc.colId);
          if (!col) return false;
          // Remove if passed the head
          return col.x > state.offsetX - cellSize;
        });
      }
    };

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const now = Date.now(); // For animations
      const physicalWidth = canvas.width;
      const physicalHeight = canvas.height;
      const state = stateRef.current;
      const currentPrice = priceRef.current ?? basePriceRef.current ?? 0;
      
      // Mobile camera scale - zooms out the view to show more grid
      const cameraScale = isMobile ? config.mobileCameraScale : 1;
      // Virtual dimensions (what we render to, scaled up so it fills physical canvas when scaled down)
      const width = physicalWidth / cameraScale;
      const height = physicalHeight / cameraScale;

      // Clear at physical size first
      const gradient = ctx.createLinearGradient(0, 0, 0, physicalHeight);
      gradient.addColorStop(0, '#12001f');
      gradient.addColorStop(0.5, GAME_CONFIG.BG_COLOR);
      gradient.addColorStop(1, '#08000f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, physicalWidth, physicalHeight);

      ctx.save();
      // Apply camera scale for mobile zoom-out effect
      ctx.scale(cameraScale, cameraScale);
      ctx.translate(0, state.cameraY);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Font sizes - scale with cell size for zoom levels
      // At zoomLevel 2.0 (low risk): cellSize=100, baseFontSize=14 -> 14px
      // At zoomLevel 1.0 (medium): cellSize=50, baseFontSize=14 -> 14px  
      // At zoomLevel 0.75 (high risk): cellSize=37, baseFontSize=14 -> ~11px (minimum)
      const baseFontSize = isMobile ? 18 : 14;
      const scaledFontSize = Math.max(10, Math.floor(baseFontSize * Math.min(1, cellSize / 50)));
      ctx.font = `${scaledFontSize}px "JetBrains Mono", "SF Mono", monospace`;
      
      const startColIndex = state.columns.findIndex(c => c.x + cellSize > state.offsetX);
      const currentHeadX = state.offsetX + headX;
      
      // DYNAMIC MULTIPLIERS: Calculate current price's Y index for multiplier calculation
      // priceY is where the price line is drawn, divide by cellSize to get cell index
      const currentPriceYIndex = Math.floor(state.priceY / cellSize);
      
      for (let i = Math.max(0, startColIndex); i < state.columns.length; i++) {
        const col = state.columns[i];
        const screenX = col.x - state.offsetX;
        
        if (screenX > width - priceAxisWidth) break;

        ctx.strokeStyle = GAME_CONFIG.GRID_LINE_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(screenX, -8000);
        ctx.lineTo(screenX, 8000);
        ctx.stroke();

        const startY = -state.cameraY - cellSize * 3;
        const endY = -state.cameraY + height + cellSize * 3;
        const minBetColumns = isMobile ? config.minBetColumnsAheadMobile : config.minBetColumnsAhead;
        const isBettable = col.x > currentHeadX + cellSize * minBetColumns;

        // Smooth animation timing
        const animTime = now * 0.001; // Seconds
        
        // DYNAMIC CELL GENERATION: Calculate visible Y range and render all cells in that range
        // This ensures cells are always drawn even if price moved rapidly
        const startYIndex = Math.floor(startY / cellSize) - 2;
        const endYIndex = Math.ceil(endY / cellSize) + 2;
        
        for (let yIndex = startYIndex; yIndex <= endYIndex; yIndex++) {
          const y = yIndex * cellSize;
          if (y < startY || y > endY) continue;
          
          // Dynamically create cell if it doesn't exist (price moved rapidly)
          if (!col.cells[yIndex]) {
            col.cells[yIndex] = {
              id: Math.random().toString(36).substr(2, 9),
              multiplier: calculateMultiplier(yIndex, currentPriceYIndex, zoomLevel),
            };
          }
          
          // ========== HEATMAP RENDERING ==========
          // Show bet density from ALL players (received from server via socket)
          const heatData = heatmapRef.current.get(`${col.id}-${yIndex}`);
          if (heatData && heatData.heat > 0) {
            const heatColor = getHeatColor(heatData.heat);
            ctx.fillStyle = heatColor;
            ctx.fillRect(screenX, y, cellSize, cellSize);
            
            // Add glow effect for hot cells (many bets)
            if (heatData.heat > 0.5) {
              ctx.shadowColor = getHeatColor(heatData.heat);
              ctx.shadowBlur = 8 * heatData.heat;
              ctx.fillRect(screenX + 2, y + 2, cellSize - 4, cellSize - 4);
              ctx.shadowBlur = 0;
            }
            
            // Show bet count for very hot cells
            if (heatData.betCount > 1) {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
              ctx.font = `bold ${Math.floor(cellSize * 0.2)}px sans-serif`;
              ctx.textAlign = 'right';
              ctx.textBaseline = 'top';
              ctx.fillText(`${heatData.betCount}🔥`, screenX + cellSize - 4, y + 4);
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
            }
          }

          // Check if this cell is being hovered
          const isHovered = hoverCellRef.current?.colId === col.id && 
                           hoverCellRef.current?.yIndex === yIndex;
          
          // Check if there's already a bet on this cell
          const hasBet = state.bets.some(b => b.colId === col.id && b.yIndex === yIndex);
          if (hasBet) continue;

          // Unique animation offset per cell for organic feel
          const cellSeed = (col.x * 0.01 + yIndex * 0.1) % 1;
          
          if (isBettable) {
            // === CLICKABLE CELL - BUBBLE STYLE ===
            const centerX = screenX + cellSize / 2;
            const centerY = y + cellSize / 2;
            
            // Breathing bubble effect - each cell breathes at slightly different rate
            const breatheSpeed = 2 + cellSeed * 0.5;
            const breathe = Math.sin(animTime * breatheSpeed + cellSeed * Math.PI * 2) * 0.5 + 0.5;
            const bubbleSize = (cellSize * 0.35) + breathe * (cellSize * 0.08);
            
            // Subtle gradient bubble background
            const gradient = ctx.createRadialGradient(
              centerX, centerY, 0,
              centerX, centerY, bubbleSize
            );
            gradient.addColorStop(0, `rgba(0, 255, 200, ${0.15 + breathe * 0.1})`);
            gradient.addColorStop(0.7, `rgba(0, 200, 255, ${0.08 + breathe * 0.05})`);
            gradient.addColorStop(1, 'rgba(0, 150, 255, 0)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(centerX, centerY, bubbleSize, 0, Math.PI * 2);
            ctx.fill();
            
            // Bubble ring - only show in low/medium risk modes (large cells)
            if (cellSize > 40) {
              ctx.strokeStyle = `rgba(0, 255, 255, ${0.2 + breathe * 0.15})`;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(centerX, centerY, bubbleSize - 2, 0, Math.PI * 2);
              ctx.stroke();
            }
            
            // Sparkle highlight on bubble - disabled for cleaner look
            // const sparkleAngle = animTime * 2 + cellSeed * 10;
            // const sparkleX = centerX + Math.cos(sparkleAngle) * bubbleSize * 0.5;
            // const sparkleY = centerY + Math.sin(sparkleAngle) * bubbleSize * 0.3 - bubbleSize * 0.2;
            // ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + breathe * 0.3})`;
            // ctx.beginPath();
            // ctx.arc(sparkleX, sparkleY, 2 + breathe, 0, Math.PI * 2);
            // ctx.fill();
            
            // HOVER: Expand and glow!
            if (isHovered) {
              const hoverPulse = Math.sin(animTime * 8) * 0.5 + 0.5;
              const hoverSize = bubbleSize * 1.3;
              
              // Outer glow
              ctx.shadowBlur = 20 + hoverPulse * 10;
              ctx.shadowColor = '#00ffff';
              
              // Bright hover ring
              ctx.strokeStyle = `rgba(0, 255, 255, ${0.8 + hoverPulse * 0.2})`;
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.arc(centerX, centerY, hoverSize, 0, Math.PI * 2);
              ctx.stroke();
              
              // Inner fill
              ctx.fillStyle = `rgba(0, 255, 255, ${0.2 + hoverPulse * 0.1})`;
              ctx.beginPath();
              ctx.arc(centerX, centerY, hoverSize - 4, 0, Math.PI * 2);
              ctx.fill();
              
              ctx.shadowBlur = 0;
            }
          } else {
            // === NON-CLICKABLE - Subtle fade ===
            const distToEdge = (currentHeadX + cellSize * minBetColumns - col.x) / cellSize;
            const fadeFactor = Math.max(0, Math.min(1, distToEdge / 4));
            ctx.fillStyle = `rgba(10, 0, 20, ${0.3 + fadeFactor * 0.3})`;
            ctx.fillRect(screenX, y, cellSize, cellSize);
          }

          // Grid dots at corners - subtle
          const dotAlpha = isBettable ? 0.4 : 0.15;
          ctx.fillStyle = isBettable 
            ? `rgba(0, 255, 200, ${dotAlpha})` 
            : `rgba(255, 100, 150, ${dotAlpha})`;
          ctx.beginPath();
          ctx.arc(screenX, y, 1.5, 0, Math.PI * 2);
          ctx.fill();

          // Multiplier text
          const dynamicMultiplier = calculateMultiplier(yIndex, currentPriceYIndex, zoomLevel);
          
          if (isBettable) {
            const textPulse = Math.sin(animTime * 3 + cellSeed * 5) * 0.5 + 0.5;
            ctx.fillStyle = isHovered 
              ? '#ffffff' 
              : `rgba(150, 255, 220, ${0.6 + textPulse * 0.2})`;
            // Scale font with cell size for readability at all zoom levels
            const multFontBase = isMobile ? 18 : 13;
            const multFontSize = Math.max(9, Math.floor(multFontBase * Math.min(1.2, cellSize / 45)));
            ctx.font = isHovered 
              ? `bold ${multFontSize + 2}px "JetBrains Mono", monospace`
              : `${multFontSize}px "JetBrains Mono", monospace`;
          } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            const dimFontBase = isMobile ? 16 : 12;
            const dimFontSize = Math.max(8, Math.floor(dimFontBase * Math.min(1.2, cellSize / 45)));
            ctx.font = `${dimFontSize}px "JetBrains Mono", monospace`;
          }
          ctx.fillText(`${dynamicMultiplier}X`, screenX + cellSize / 2, y + cellSize / 2);
        }
      }

      state.bets.forEach(bet => {
        const col = state.columns.find(c => c.id === bet.colId);
        if (!col) return;

        const screenX = col.x - state.offsetX;
        const y = bet.yIndex * cellSize;
        const centerX = screenX + cellSize / 2;
        const centerY = y + cellSize / 2;
        
        if (screenX < -cellSize || screenX > width) return;

        const isPending = bet.status === 'pending' || bet.status === 'placing';
        const isWon = bet.status === 'won';
        const isLost = bet.status === 'lost';
        
        if (isPending) {
          // === PENDING BET - Simple clean style (no animations for performance) ===
          
          // Solid yellow-green background
          ctx.fillStyle = '#c8e64c';
          ctx.beginPath();
          ctx.roundRect(screenX + 4, y + 4, cellSize - 8, cellSize - 8, 6);
          ctx.fill();
          
          // Simple border
          ctx.strokeStyle = '#a8c63c';
          ctx.lineWidth = 2;
          ctx.stroke();
          
          // Gem icon and amount
          ctx.fillStyle = '#1a2e0a';
          ctx.font = `bold ${isMobile ? 18 : 14}px sans-serif`;
          ctx.fillText(`💎${bet.amount}`, centerX, centerY - 4);
          ctx.font = `bold ${isMobile ? 14 : 11}px sans-serif`;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.fillText(`${bet.multiplier.toFixed(2)}X`, centerX, centerY + 12);
          
        } else if (isWon) {
          // === WON BET - Simple clean green ===
          
          // Solid green background
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.roundRect(screenX + 4, y + 4, cellSize - 8, cellSize - 8, 6);
          ctx.fill();
          
          // Light border
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.lineWidth = 2;
          ctx.stroke();
          
          // Win text
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${isMobile ? 16 : 13}px sans-serif`;
          ctx.fillText(`+${(bet.amount * bet.multiplier).toFixed(0)}`, centerX, centerY);
          
          // Small gem indicator
          ctx.font = `${isMobile ? 11 : 9}px sans-serif`;
          ctx.fillText('💎', centerX, centerY + 14);
          
        } else if (isLost) {
          // === LOST BET - Fade out ===
          ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
          ctx.beginPath();
          ctx.roundRect(screenX + 6, y + 6, cellSize - 12, cellSize - 12, 6);
          ctx.fill();
          
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
          
          // X mark
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(centerX - 8, centerY - 8);
          ctx.lineTo(centerX + 8, centerY + 8);
          ctx.moveTo(centerX + 8, centerY - 8);
          ctx.lineTo(centerX - 8, centerY + 8);
          ctx.stroke();
          
          // Lost amount text
          ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
          ctx.font = `${isMobile ? 11 : 9}px sans-serif`;
          ctx.fillText(`-${bet.amount}`, centerX, centerY + 16);
        }
        
        // DEBUG: Win zone indicator (cyan corners) - commented out for production
        // Uncomment to visualize the shrunk win zone during debugging
        /*
        if (bet.winPriceMin !== undefined && bet.winPriceMax !== undefined && bet.basePriceAtBet !== undefined && bet.status === 'pending') {
          const winYTop = -(bet.winPriceMax - bet.basePriceAtBet) * config.priceScale + cellSize / 2;
          const winYBottom = -(bet.winPriceMin - bet.basePriceAtBet) * config.priceScale + cellSize / 2;
          
          // Draw simple corner markers (fast)
          ctx.strokeStyle = '#00ffff';
          ctx.lineWidth = 2;
          const cornerSize = 6;
          
          // Top-left corner
          ctx.beginPath();
          ctx.moveTo(screenX, winYTop + cornerSize);
          ctx.lineTo(screenX, winYTop);
          ctx.lineTo(screenX + cornerSize, winYTop);
          ctx.stroke();
          
          // Top-right corner
          ctx.beginPath();
          ctx.moveTo(screenX + cellSize - cornerSize, winYTop);
          ctx.lineTo(screenX + cellSize, winYTop);
          ctx.lineTo(screenX + cellSize, winYTop + cornerSize);
          ctx.stroke();
          
          // Bottom-left corner
          ctx.beginPath();
          ctx.moveTo(screenX, winYBottom - cornerSize);
          ctx.lineTo(screenX, winYBottom);
          ctx.lineTo(screenX + cornerSize, winYBottom);
          ctx.stroke();
          
          // Bottom-right corner
          ctx.beginPath();
          ctx.moveTo(screenX + cellSize - cornerSize, winYBottom);
          ctx.lineTo(screenX + cellSize, winYBottom);
          ctx.lineTo(screenX + cellSize, winYBottom - cornerSize);
          ctx.stroke();
        }
        */
      });
      
      // ✨ SPECIAL CELLS - Render with glowing rainbow effect
      if (state.specialCells && state.specialCells.length > 0) {
        const animTime = now * 0.001;
        
        state.specialCells.forEach(sc => {
          const col = state.columns.find(c => c.id === sc.colId);
          if (!col) return;
          
          const screenX = col.x - state.offsetX;
          const y = sc.yIndex * cellSize;
          const centerX = screenX + cellSize / 2;
          const centerY = y + cellSize / 2;
          
          if (screenX < -cellSize || screenX > width) return;
          
          // Color based on bonus type: 5X = gold/orange, 2X = rainbow
          const is5xCell = sc.bonusMultiplier >= 5;
          const hue = is5xCell 
            ? 40 + Math.sin(animTime * 2) * 15 // Gold oscillating 25-55
            : (animTime * 60 + parseInt(sc.id, 36) % 360) % 360; // Rainbow
          const pulse = Math.sin(animTime * (is5xCell ? 5 : 3)) * 0.5 + 0.5; // 5X pulses faster
          
          // Outer glow rings (multiple for intense effect)
          for (let ring = 0; ring < 3; ring++) {
            const ringSize = cellSize * 0.5 + ring * 8 + pulse * 5;
            const ringAlpha = 0.3 - ring * 0.1;
            
            ctx.strokeStyle = `hsla(${hue + ring * 30}, 100%, 60%, ${ringAlpha})`;
            ctx.lineWidth = 3 - ring;
            ctx.shadowBlur = 20;
            ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ringSize, 0, Math.PI * 2);
            ctx.stroke();
          }
          
          // Rotating star points
          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(animTime * 2);
          
          const starSize = cellSize * 0.35;
          ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
          ctx.shadowBlur = 25;
          ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const outerX = Math.cos(angle) * starSize;
            const outerY = Math.sin(angle) * starSize;
            const innerAngle = angle + Math.PI / 6;
            const innerX = Math.cos(innerAngle) * starSize * 0.4;
            const innerY = Math.sin(innerAngle) * starSize * 0.4;
            
            if (i === 0) ctx.moveTo(outerX, outerY);
            else ctx.lineTo(outerX, outerY);
            ctx.lineTo(innerX, innerY);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          
          // Inner gem
          const gemGrad = ctx.createRadialGradient(centerX - 5, centerY - 5, 0, centerX, centerY, cellSize * 0.3);
          gemGrad.addColorStop(0, `hsla(${hue + 60}, 100%, 90%, 1)`);
          gemGrad.addColorStop(0.5, `hsla(${hue}, 100%, 60%, 1)`);
          gemGrad.addColorStop(1, `hsla(${hue - 30}, 100%, 40%, 1)`);
          
          ctx.fillStyle = gemGrad;
          ctx.shadowBlur = 15;
          ctx.beginPath();
          ctx.arc(centerX, centerY, cellSize * 0.25, 0, Math.PI * 2);
          ctx.fill();
          
          // Bonus text - different for 5X vs 2X
          const is5x = sc.bonusMultiplier >= 5;
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${isMobile ? 11 : 9}px sans-serif`;
          ctx.fillText(is5x ? '5X' : '2X', centerX, centerY - 2);
          ctx.font = `${isMobile ? 8 : 6}px sans-serif`;
          ctx.fillText(is5x ? 'RARE!' : 'BONUS', centerX, centerY + 8);
          
          // Sparkle particles around the cell
          for (let i = 0; i < 4; i++) {
            const sparkAngle = animTime * 4 + (i / 4) * Math.PI * 2;
            const sparkDist = cellSize * 0.6 + Math.sin(animTime * 6 + i) * 5;
            const sparkX = centerX + Math.cos(sparkAngle) * sparkDist;
            const sparkY = centerY + Math.sin(sparkAngle) * sparkDist;
            
            ctx.fillStyle = `hsla(${hue + i * 90}, 100%, 80%, ${0.6 + pulse * 0.4})`;
            ctx.beginPath();
            ctx.arc(sparkX, sparkY, 2 + pulse, 0, Math.PI * 2);
            ctx.fill();
          }
        });
        
        ctx.shadowBlur = 0;
      }
      
      // Particles disabled for performance
      // if (state.particles && state.particles.length > 0) {
      //   renderParticles(ctx, state.particles, state.offsetX);
      // }

      if (state.priceHistory.length > 1) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = GAME_CONFIG.PRICE_LINE_GLOW;
        ctx.strokeStyle = GAME_CONFIG.PRICE_LINE_COLOR;
        // Mobile line thicker to compensate for camera zoom-out
        ctx.lineWidth = isMobile ? 3.5 : 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        const firstPoint = state.priceHistory[0];
        ctx.moveTo(firstPoint.x - state.offsetX, firstPoint.y);
        
        for (let i = 1; i < state.priceHistory.length; i++) {
          const p = state.priceHistory[i];
          ctx.lineTo(p.x - state.offsetX, p.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        // Mobile circles larger to compensate for camera zoom-out
        ctx.arc(headX, state.priceY, isMobile ? 9 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = GAME_CONFIG.PRICE_LINE_COLOR;
        ctx.beginPath();
        // Mobile circles larger to compensate for camera zoom-out
        ctx.arc(headX, state.priceY, isMobile ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        
        // === CHAT BUBBLE above price head ===
        const chatBubble = chatBubbleRef.current;
        if (chatBubble) {
          const elapsed = now - chatBubble.startTime;
          const progress = elapsed / chatBubble.duration;
          
          // Fade in/out
          let alpha = 1;
          if (progress < 0.1) {
            alpha = progress / 0.1; // Fade in
          } else if (progress > 0.8) {
            alpha = (1 - progress) / 0.2; // Fade out
          }
          
          // Slight float up animation
          const floatY = progress * 8;
          
          const bubbleX = headX;
          const bubbleY = state.priceY - 35 - floatY;
          const message = chatBubble.message;
          
          // Measure text
          ctx.font = `bold ${isMobile ? 13 : 11}px "JetBrains Mono", monospace`;
          const textWidth = ctx.measureText(message).width;
          const padding = 10;
          const bubbleWidth = textWidth + padding * 2;
          const bubbleHeight = isMobile ? 26 : 22;
          
          // Draw bubble background
          ctx.globalAlpha = alpha * 0.95;
          ctx.fillStyle = '#1a1a2e';
          ctx.beginPath();
          ctx.roundRect(bubbleX - bubbleWidth / 2, bubbleY - bubbleHeight / 2, bubbleWidth, bubbleHeight, 8);
          ctx.fill();
          
          // Bubble border
          ctx.strokeStyle = GAME_CONFIG.PRICE_LINE_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();
          
          // Little triangle pointer
          ctx.fillStyle = '#1a1a2e';
          ctx.beginPath();
          ctx.moveTo(bubbleX - 6, bubbleY + bubbleHeight / 2);
          ctx.lineTo(bubbleX, bubbleY + bubbleHeight / 2 + 8);
          ctx.lineTo(bubbleX + 6, bubbleY + bubbleHeight / 2);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = GAME_CONFIG.PRICE_LINE_COLOR;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bubbleX - 6, bubbleY + bubbleHeight / 2);
          ctx.lineTo(bubbleX, bubbleY + bubbleHeight / 2 + 8);
          ctx.lineTo(bubbleX + 6, bubbleY + bubbleHeight / 2);
          ctx.stroke();
          
          // Cover the top of triangle with bubble color
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(bubbleX - 7, bubbleY + bubbleHeight / 2 - 2, 14, 4);
          
          // Draw text
          ctx.globalAlpha = alpha;
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(message, bubbleX, bubbleY);
          
          ctx.globalAlpha = 1;
        }
      }

      ctx.restore();

      // Price axis - HIDDEN on mobile for more game space
      if (!isMobile) {
        ctx.fillStyle = '#0a0014';
        ctx.fillRect(width - priceAxisWidth, 0, priceAxisWidth, height);
        
        ctx.strokeStyle = 'rgba(255, 100, 150, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(width - priceAxisWidth, 0);
        ctx.lineTo(width - priceAxisWidth, height);
        ctx.stroke();

        const displayPriceValue = priceRef.current ?? currentPrice ?? 100;
        const centerScreenY = height / 2;
        
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        
        const priceStep = 0.02;
        const labelStep = 5;
        
        for (let i = -40; i <= 40; i++) {
          const pixelOffset = i * (priceStep * config.priceScale);
          const screenY = centerScreenY + pixelOffset;
          
          if (screenY < 0 || screenY > height) continue;
          
          const priceAtLevel = displayPriceValue - (i * priceStep);
          
          ctx.strokeStyle = 'rgba(255, 100, 150, 0.25)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(width - priceAxisWidth, screenY);
          ctx.lineTo(width - priceAxisWidth + 5, screenY);
          ctx.stroke();
          
          if (i % labelStep === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillText(`$${priceAtLevel.toFixed(2)}`, width - 6, screenY);
          }
        }
        
        ctx.fillStyle = GAME_CONFIG.PRICE_LINE_COLOR;
        ctx.fillRect(width - priceAxisWidth, centerScreenY - 12, priceAxisWidth, 24);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.fillText(`$${displayPriceValue.toFixed(2)}`, width - 6, centerScreenY);
      }
      
      // Speed bar - full width on mobile since no price axis
      const speedBarWidth = isMobile ? width : width - priceAxisWidth;
      const speedRatio = state.currentSpeed / config.gridSpeedActive;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, height - 4, speedBarWidth, 4);
      
      const speedColor = speedRatio > 0.5 ? '#4ade80' : speedRatio > 0.2 ? '#fbbf24' : '#ef4444';
      ctx.fillStyle = speedColor;
      ctx.fillRect(0, height - 4, speedBarWidth * speedRatio, 4);
    };

    const animate = () => {
      updatePhysics();
      render();
      requestRef.current = requestAnimationFrame(animate);
    };

    if (!stateRef.current.initialized) {
      const state = stateRef.current;
      state.offsetX = 0;
      state.priceY = cellSize / 2;
      state.targetPriceY = cellSize / 2;
      state.priceHistory = [{ x: headX, y: cellSize / 2 }];
      state.columns = [];
      state.bets = [];
      state.lastGenX = 0;
      state.cameraY = window.innerHeight / 2;
      state.initialized = true;
      state.recentPrices = [];
      state.currentSpeed = config.gridSpeedActive;
      state.lastPrice = null;
      
      // Generate enough columns for the visible area plus large buffer for high volatility
      // Account for zoom level - smaller cells = more columns needed
      const minBetCols = isMobile ? config.minBetColumnsAheadMobile : config.minBetColumnsAhead;
      const neededWidth = window.innerWidth + cellSize * (minBetCols + 30);
      for (let x = 0; x < neededWidth; x += cellSize) {
        generateColumn(x, cellSize / 2);
      }
    }

    requestRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- TARGET_FRAME_MS is a constant, zoomLevel is covered by getCellSize
  }, [generateColumn, playSound, getCellSize, getHeadX, getPriceAxisWidth, isMobile, onBalanceChange, onTotalWonChange, onTotalLostChange, onWin]);

  // Resize handler - dynamic canvas sizing
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout;
    
    const handleResize = () => {
      // Debounce resize events for performance
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const newWidth = window.innerWidth - sidebarWidth;
          const newHeight = window.innerHeight;
          
          // Only update if dimensions actually changed
          if (canvas.width !== newWidth || canvas.height !== newHeight) {
            canvas.width = newWidth;
            canvas.height = newHeight;
            
            // Generate additional columns if needed after resize
            const state = stateRef.current;
            if (state.initialized) {
              const cellSize = getCellSize();
              const neededX = state.offsetX + newWidth + 600;
              
              while (state.lastGenX < neededX) {
                const newColX = state.lastGenX + cellSize;
                generateColumn(newColX, state.priceY);
              }
            }
          }
        }
      }, 50); // 50ms debounce
    };
    
    // Listen for resize and orientation change
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    // Also handle visibility change (tab switching can affect layout)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleResize();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    
    // Initial size
    handleResize();
    
    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [sidebarWidth, getCellSize, generateColumn]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const cfg = serverConfigRef.current;
    if (!cfg) return; // Wait for config
    
    setIsDragging(true);
    isDraggingRef.current = true;
    dragBetQueueRef.current = []; // Clear any stale queue
    lastBetCellRef.current = null;
    const rect = canvasRef.current!.getBoundingClientRect();
    // Scale input coordinates for mobile camera zoom-out
    const cameraScale = isMobile ? cfg.mobileCameraScale : 1;
    const screenX = (e.clientX - rect.left) / cameraScale;
    const screenY = (e.clientY - rect.top) / cameraScale;
    placeBetAt(screenX, screenY, true);
  }, [placeBetAt, isMobile]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const cfg = serverConfigRef.current;
    if (!cfg) return; // Wait for config
    
    const rect = canvasRef.current!.getBoundingClientRect();
    // Scale input coordinates for mobile camera zoom-out
    const cameraScale = isMobile ? cfg.mobileCameraScale : 1;
    const screenX = (e.clientX - rect.left) / cameraScale;
    const screenY = (e.clientY - rect.top) / cameraScale;
    
    // Track hover position for effects
    const state = stateRef.current;
    const cellSize = Math.floor((isMobile ? cfg.cellSizeMobile : cfg.cellSize) * zoomLevel);
    const headX = isMobile ? cfg.headXMobile : cfg.headX;
    
    const worldX = state.offsetX + screenX;
    const worldY = screenY - state.cameraY;
    mouseWorldPosRef.current = { x: worldX, y: worldY };
    
    // Find hovered cell
    const clickedCol = state.columns.find(col => 
      worldX >= col.x && worldX < col.x + cellSize
    );
    
    if (clickedCol) {
      const yIndex = Math.floor(worldY / cellSize);
      const minBetColumns = isMobile ? cfg.minBetColumnsAheadMobile : cfg.minBetColumnsAhead;
      const isBettable = clickedCol.x > state.offsetX + headX + cellSize * minBetColumns;
      
      if (isBettable) {
        hoverCellRef.current = { colId: clickedCol.id, yIndex };
      } else {
        hoverCellRef.current = null;
      }
    } else {
      hoverCellRef.current = null;
    }
    
    // Handle dragging for bet placement
    if (isDragging) {
      placeBetAt(screenX, screenY, false);
    }
  }, [isDragging, placeBetAt, isMobile, zoomLevel]);

  const handlePointerUp = useCallback(async () => {
    setIsDragging(false);
    isDraggingRef.current = false;
    lastBetCellRef.current = null;
    
    // FLUSH DRAG BET QUEUE - Send all queued bets via socket batch
    const queue = dragBetQueueRef.current;
    if (queue.length > 0 && isAuthenticated) {
      dragBetQueueRef.current = []; // Clear queue immediately
      
      const socket = socketRef.current;
      if (!socket?.connected) {
        // Socket not connected - refund all queued bets
        const state = stateRef.current;
        for (const queuedBet of queue) {
          const betIndex = state.bets.findIndex(b => b.id === queuedBet.localId);
          if (betIndex !== -1) {
            state.bets.splice(betIndex, 1);
          }
          balanceRef.current += queuedBet.amount;
          pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - queuedBet.amount);
          setPendingBetsCount(prev => Math.max(0, prev - 1));
        }
        onBalanceChange(balanceRef.current);
        return;
      }
      
      // Send batch via socket with client's world position
      const currentState = stateRef.current;
      socket.emit('placeBetBatch', {
        sessionId: sessionIdRef.current,
        clientOffsetX: currentState.offsetX,
        bets: queue.map(q => ({
          colId: q.columnId,
          yIndex: q.yIndex,
          wager: q.amount,
          oddsIndex: q.oddsIndex,
          oddsMultiplier: q.multiplier.toString(),
          basePrice: q.basePrice,
          cellSize: q.cellSize,
        })),
      }, (result: { 
        success: boolean; 
        results: Array<{ index: number; success: boolean; betId?: string; error?: string }>;
        newBalance?: number;
        error?: string;
      }) => {
        if (result.success && result.results) {
          const state = stateRef.current;
          
          // Update each bet with server response
          for (const betResult of result.results) {
            const queuedBet = queue[betResult.index];
            if (!queuedBet) continue;
            
            const bet = state.bets.find(b => b.id === queuedBet.localId);
            if (!bet) continue;
            
            if (betResult.success && betResult.betId) {
              bet.serverId = betResult.betId;
              bet.status = 'pending';
            } else {
              // Bet rejected - remove from UI and refund
              const betIndex = state.bets.findIndex(b => b.id === queuedBet.localId);
              if (betIndex !== -1) {
                state.bets.splice(betIndex, 1);
              }
              balanceRef.current += queuedBet.amount;
              pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - queuedBet.amount);
              setPendingBetsCount(prev => Math.max(0, prev - 1));
            }
          }
          
          // Sync balance from server
          if (typeof result.newBalance === 'number') {
            balanceRef.current = result.newBalance;
            onBalanceChange(result.newBalance);
          }
        } else {
          // Entire batch failed - refund all
          const state = stateRef.current;
          for (const queuedBet of queue) {
            const betIndex = state.bets.findIndex(b => b.id === queuedBet.localId);
            if (betIndex !== -1) {
              state.bets.splice(betIndex, 1);
            }
            balanceRef.current += queuedBet.amount;
            pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - queuedBet.amount);
            setPendingBetsCount(prev => Math.max(0, prev - 1));
          }
          onBalanceChange(balanceRef.current);
          onError?.(result.error || 'Failed to place bets');
        }
      });
    }
  }, [isAuthenticated, onBalanceChange, onError]);

  const handlePointerLeave = useCallback(() => {
    // Trigger pointer up to flush any queued bets
    if (isDraggingRef.current) {
      handlePointerUp();
    }
    setIsDragging(false);
    isDraggingRef.current = false;
    lastBetCellRef.current = null;
    hoverCellRef.current = null;
    mouseWorldPosRef.current = null;
  }, [handlePointerUp]);

  // Check if there are any active bets (pending or placing)
  const hasActiveBets = stateRef.current.bets.some(
    b => b.status === 'pending' || b.status === 'placing'
  );

  // Cycle through zoom levels - DISABLED when bets are active or on mobile
  const cycleZoom = useCallback(() => {
    // Mobile users are locked to low risk mode (index 0)
    if (isMobile) {
      return; // Zoom locked on mobile - low risk only
    }
    
    // Don't allow zoom changes while bets are on the board
    const activeBets = stateRef.current.bets.filter(
      b => b.status === 'pending' || b.status === 'placing'
    );
    if (activeBets.length > 0) {
      return; // Zoom locked while bets are active
    }
    if (!serverConfigRef.current) return; // Wait for server config
    setZoomIndex(prev => (prev + 1) % serverConfigRef.current!.zoomLevels.length);
  }, [isMobile]);

  return {
    canvasRef,
    configLoaded,
    volatilityLevel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    isDragging,
    updatePrice,
    pendingBetsCount,
    zoomLevel,
    zoomIndex,
    cycleZoom,
    zoomLocked: hasActiveBets,
    placeBetAt,
    serverConfig: serverConfigRef.current,
  };
}

