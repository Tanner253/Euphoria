'use client';

/**
 * useGameEngine - Core game logic hook for the prediction market
 * 
 * SERVER-AUTHORITATIVE: All bet placement and resolution goes through server APIs
 * The client is only responsible for rendering - never trusted for balance/outcomes
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { GAME_CONFIG, calculateMultiplier } from '@/lib/game/gameConfig';
import { getGameSounds } from '@/lib/audio/GameSounds';
import { gameAPI } from '@/lib/services/GameAPI';
import type { Bet, Column, GameState, VolatilityLevel, Particle, SpecialCell } from '@/lib/game/types';

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

function emitBetPlacedParticles(x: number, y: number): Particle[] {
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

function emitWinParticles(x: number, y: number): Particle[] {
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

function updateParticles(particles: Particle[], deltaTime: number): Particle[] {
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

function renderParticles(ctx: CanvasRenderingContext2D, particles: Particle[], offsetX: number) {
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
  "btc ATH: $69,000 (nice)",
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
let lastSignificantMoveTime = Date.now(); // Initialize to now, not 0
let priceWasFlat = false;
let flatStartTime = 0;

interface UseGameEngineOptions {
  isMobile: boolean;
  balance: number;
  betAmount: number;
  sessionId: string;  // Game session ID for bet tracking
  isAuthenticated: boolean;  // Whether user is authenticated
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
}

export function useGameEngine({
  isMobile,
  balance,
  betAmount,
  sessionId,
  isAuthenticated,
  isAutoPlaying = false,
  sidebarWidth = 56,
  onBalanceChange,
  onWin,
  onTotalWonChange,
  onTotalLostChange,
  onError,
}: UseGameEngineOptions): UseGameEngineReturn {
  const [volatilityLevel, setVolatilityLevel] = useState<VolatilityLevel>('active');
  const [isDragging, setIsDragging] = useState(false);
  const [pendingBetsCount, setPendingBetsCount] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(0);
  const zoomLevel = GAME_CONFIG.ZOOM_LEVELS[zoomIndex];
  
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
    currentSpeed: GAME_CONFIG.GRID_SPEED_ACTIVE,
    lastPrice: null,
    particles: [],
    specialCells: [],
    lastSpecialCellTime: Date.now(),
  });
  
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
    if (!state.initialized) return;
    
    const cellSize = Math.floor((isMobile ? GAME_CONFIG.CELL_SIZE_MOBILE : GAME_CONFIG.CELL_SIZE) * zoomLevel);
    const headX = isMobile ? GAME_CONFIG.HEAD_X_MOBILE : GAME_CONFIG.HEAD_X;
    
    // Clear columns and reset grid
    state.columns = [];
    state.lastGenX = 0;
    state.offsetX = 0;
    state.priceY = cellSize / 2;
    state.targetPriceY = cellSize / 2;
    state.priceHistory = [{ x: headX, y: cellSize / 2 }];
    // Use virtual height for camera (accounts for mobile zoom-out)
    const initCameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
    state.cameraY = (window.innerHeight / initCameraScale) / 2;
    
    // Regenerate columns with proper cells using generateColumn pattern
    const priceY = cellSize / 2;
    for (let x = 0; x < window.innerWidth + 600; x += cellSize) {
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
  const getCellSize = useCallback(() => {
    const baseSize = isMobile ? GAME_CONFIG.CELL_SIZE_MOBILE : GAME_CONFIG.CELL_SIZE;
    return Math.floor(baseSize * zoomLevel);
  }, [isMobile, zoomLevel]);
  const getHeadX = useCallback(() => isMobile ? GAME_CONFIG.HEAD_X_MOBILE : GAME_CONFIG.HEAD_X, [isMobile]);
  // Price axis hidden on mobile for more game space
  const getPriceAxisWidth = useCallback(() => isMobile ? 0 : GAME_CONFIG.PRICE_AXIS_WIDTH, [isMobile]);
  const getMinBetColumnsAhead = useCallback(() => isMobile ? GAME_CONFIG.MIN_BET_COLUMNS_AHEAD_MOBILE : GAME_CONFIG.MIN_BET_COLUMNS_AHEAD, [isMobile]);

  const generateColumn = useCallback((xPosition: number, currentPriceY: number) => {
    const state = stateRef.current;
    const cellSize = getCellSize();
    const currentPriceIndex = Math.floor((currentPriceY + cellSize / 2) / cellSize);
    
    const cells: Record<number, { id: string; multiplier: string }> = {};
    for (let i = -GAME_CONFIG.VERTICAL_CELLS; i <= GAME_CONFIG.VERTICAL_CELLS; i++) {
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
    
    if (state.columns.length > 100) {
      state.columns.shift();
    }
    
    state.lastGenX = xPosition;
  }, [getCellSize]);

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
    const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
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
          multiplier *= specialCell.bonusMultiplier; // 2x bonus!
          isSpecialBet = true;
          // Remove the special cell once a bet is placed on it
          state.specialCells = state.specialCells.filter(sc => sc.id !== specialCell.id);
          console.log('[Special Cell] 2X BONUS applied! New multiplier:', multiplier);
        }
        
        // IMMEDIATE WIN ZONE CALCULATION - same formula as server
        // This enables instant win zone rendering without waiting for server
        const basePrice = basePriceRef.current ?? 0;
        const cellYTop = yIndex * cellSize;
        const cellYBottom = (yIndex + 1) * cellSize;
        const winPriceMax = basePrice + (cellSize / 2 - cellYTop) / GAME_CONFIG.PRICE_SCALE;
        const winPriceMin = basePrice + (cellSize / 2 - cellYBottom) / GAME_CONFIG.PRICE_SCALE;
        
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
            columnId: clickedCol.id,
            yIndex,
            basePrice,
            cellSize,
            amount: currentBetAmount,
            multiplier,
          });
          return true; // Bet queued, will be sent on drag end
        }
        
        // SINGLE BET: Send immediately
        try {
          const result = await gameAPI.placeBet({
            sessionId: sessionIdRef.current,
            columnId: clickedCol.id,
            yIndex,
            basePrice,
            cellSize,
            amount: currentBetAmount,
            multiplier,
          });
          
          if (result.success && result.bet) {
            // Update bet with server data (including win boundaries)
            const bet = state.bets.find(b => b.id === localBetId);
            if (bet) {
              bet.serverId = result.bet.id;
              bet.status = 'pending';
              bet.priceAtBet = result.bet.priceAtBet;
              // Store server-calculated win boundaries for visualization
              bet.winPriceMin = result.bet.winPriceMin;
              bet.winPriceMax = result.bet.winPriceMax;
            }
            
            // Server confirmed - clear pending tracking
            pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - currentBetAmount);
            // DON'T overwrite balance here - optimistic deduction is already correct
            // Only sync balance after ALL pending bets are resolved to avoid race conditions
            // The server balance will be synced when wins/losses are processed
          } else {
            // Bet REJECTED by server - REFUND the optimistic deduction
            const betIndex = state.bets.findIndex(b => b.id === localBetId);
            if (betIndex !== -1) {
              state.bets.splice(betIndex, 1);
            }
            
            // Refund: add the bet amount back
            pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - currentBetAmount);
            balanceRef.current += currentBetAmount;
            onBalanceChange(balanceRef.current);
            
            onError?.(result.error || 'Failed to place bet');
            playSound('lose');
            setPendingBetsCount(prev => Math.max(0, prev - 1));
            return false;
          }
        } catch {
          // Network error - REFUND the optimistic deduction
          const betIndex = state.bets.findIndex(b => b.id === localBetId);
          if (betIndex !== -1) {
            state.bets.splice(betIndex, 1);
          }
          
          // Refund: add the bet amount back
          pendingBetAmountRef.current = Math.max(0, pendingBetAmountRef.current - currentBetAmount);
          balanceRef.current += currentBetAmount;
          onBalanceChange(balanceRef.current);
          
          onError?.('Network error - please try again');
          setPendingBetsCount(prev => Math.max(0, prev - 1));
          return false;
        }
        
        return true;
      }
    }
    return false;
  }, [isAuthenticated, playSound, getCellSize, getHeadX, getPriceAxisWidth, onBalanceChange, onError]);

  const updatePrice = useCallback((price: number | null) => {
    if (price !== null) {
      priceRef.current = price;
    }
  }, []);

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cellSize = getCellSize();
    const headX = getHeadX();
    const priceAxisWidth = getPriceAxisWidth();

    // SERVER-AUTHORITATIVE: Resolve bets through API
    const checkBets = async (currentHeadX: number, headY: number) => {
      const state = stateRef.current;
      
      for (const bet of state.bets) {
        // Only process pending bets that aren't already resolving
        if (bet.status !== 'pending' || bet.resolving) continue;

        const col = state.columns.find(c => c.id === bet.colId);
        if (!col) {
          // Column no longer exists - loss
          bet.status = 'lost';
          onTotalLostChange(prev => prev + bet.amount);
          playSound('lose');
          setPendingBetsCount(prev => Math.max(0, prev - 1));
          continue;
        }

        const betEndX = col.x + cellSize;
        
        // When price line passes the bet column, resolve the bet
        if (currentHeadX > betEndX) {
          // Helper to get the Y RANGE the price line travels through within column bounds
          // This allows wins when the price TOUCHES the cell at ANY point, not just at center
          const getYRangeInColumn = (colStartX: number, colEndX: number): { minY: number; maxY: number; centerY: number } | null => {
            let minY = Infinity;
            let maxY = -Infinity;
            let centerY: number | null = null;
            const colCenter = colStartX + (colEndX - colStartX) / 2;
            
            for (let i = 0; i < state.priceHistory.length - 1; i++) {
              const p1 = state.priceHistory[i];
              const p2 = state.priceHistory[i + 1];
              
              // Check if this segment overlaps with the column
              if (p2.x < colStartX || p1.x > colEndX) continue;
              
              // Get Y values at the boundaries of overlap
              const segStartX = Math.max(p1.x, colStartX);
              const segEndX = Math.min(p2.x, colEndX);
              
              // Interpolate Y at segment boundaries
              const getYAt = (x: number) => {
                if (p2.x === p1.x) return p1.y;
                const t = (x - p1.x) / (p2.x - p1.x);
                return p1.y + t * (p2.y - p1.y);
              };
              
              const y1 = getYAt(segStartX);
              const y2 = getYAt(segEndX);
              
              minY = Math.min(minY, y1, y2);
              maxY = Math.max(maxY, y1, y2);
          
              // Get Y at center for server communication
              if (segStartX <= colCenter && segEndX >= colCenter) {
                centerY = getYAt(colCenter);
              }
            }
            
            if (minY === Infinity) return null;
            return { minY, maxY, centerY: centerY ?? (minY + maxY) / 2 };
          };
          
          // Get the full Y range the price traveled through in this column
          const yRange = getYRangeInColumn(col.x, col.x + cellSize);
          const priceYAtCrossing = yRange?.centerY ?? headY;
          
          // WIN DETECTION: Check if price line entered the INNER WIN ZONE of the cell
          // Win zone is shrunk by WIN_ZONE_MARGIN on each side for house edge
          const margin = cellSize * GAME_CONFIG.WIN_ZONE_MARGIN;
          const cellTopY = bet.yIndex * cellSize + margin;      // Shrunk top
          const cellBottomY = (bet.yIndex + 1) * cellSize - margin;  // Shrunk bottom
          
          // Line must enter the shrunk win zone to count as a win
          const isWin = yRange 
            ? (yRange.minY < cellBottomY && yRange.maxY > cellTopY)
            : false;
          
          // DEMO MODE: Resolve client-side
          if (!bet.serverId) {
            bet.status = isWin ? 'won' : 'lost';
            const autoPlaying = isAutoPlayingRef.current;
            
            // Calculate how close the outcome was for chat messages
            const cellCenterY = (bet.yIndex + 0.5) * cellSize;
            const priceDistFromCenter = yRange 
              ? Math.min(Math.abs(yRange.minY - cellCenterY), Math.abs(yRange.maxY - cellCenterY))
              : cellSize;
            const wasClose = priceDistFromCenter < cellSize * 0.6;
            
            if (isWin) {
              consecutiveWins++;
              consecutiveLosses = 0;
              
              const winAmount = bet.amount * bet.multiplier;
              // Skip balance changes in auto-play mode (infinite gems)
              if (!autoPlaying) {
              onBalanceChange(balanceRef.current + winAmount);
              balanceRef.current += winAmount;
              }
              onTotalWonChange(prev => prev + winAmount - bet.amount);
              
              // Calculate screen position for win popup
              const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
              const screenX = (col.x - state.offsetX + cellSize / 2) * cameraScale;
              const screenY = (bet.yIndex * cellSize + state.cameraY) * cameraScale;
              
              onWin({ amount: winAmount, id: bet.id, screenX, screenY });
              playSound('win');
              
              // Chat bubble for win
              const now = Date.now();
              if (now - lastChatTimeRef.current > 1500) { // Short cooldown for game events
                let chatCategory: keyof typeof CHAT_MESSAGES;
                if (consecutiveWins >= 3) {
                  chatCategory = 'winStreak';
                } else if (bet.multiplier >= 2.0) {
                  chatCategory = 'userBigWin';
                } else if (wasClose) {
                  chatCategory = 'closeCall';
                } else {
                  chatCategory = 'userWin';
                }
                chatBubbleRef.current = {
                  message: pickRandomMessage(chatCategory),
                  startTime: now,
                  duration: CHAT_DURATION,
                };
                lastChatTimeRef.current = now;
              }
            } else {
              consecutiveLosses++;
              consecutiveWins = 0;
              
              // Skip loss tracking in auto-play mode
              if (!autoPlaying) {
              onTotalLostChange(prev => prev + bet.amount);
              }
              playSound('lose');
              
              // Chat bubble for loss
              const now = Date.now();
              if (now - lastChatTimeRef.current > 1500) {
                let chatCategory: keyof typeof CHAT_MESSAGES;
                if (consecutiveLosses >= 3) {
                  chatCategory = 'lossStreak';
                } else if (wasClose) {
                  chatCategory = 'nearMiss';
                } else if (bet.amount >= 50) {
                  chatCategory = 'userBigLoss';
                } else {
                  chatCategory = 'userLoss';
                }
                chatBubbleRef.current = {
                  message: pickRandomMessage(chatCategory),
                  startTime: now,
                  duration: CHAT_DURATION,
                };
                lastChatTimeRef.current = now;
              }
            }
            setPendingBetsCount(prev => Math.max(0, prev - 1));
            continue;
          }
          
          // AUTHENTICATED: OPTIMISTIC resolution for instant feedback
          // Show win/loss immediately, confirm with server in background
          bet.resolving = true;
          
          // Calculate the price RANGE at crossing for "touch" detection
          const resolveBasePrice = bet.basePriceAtBet ?? basePriceRef.current ?? 0;
          const priceAtCrossing = resolveBasePrice + (cellSize / 2 - priceYAtCrossing) / GAME_CONFIG.PRICE_SCALE;
          
          // Convert Y range to price range for server validation
          const priceRangeMin = yRange 
            ? resolveBasePrice + (cellSize / 2 - yRange.maxY) / GAME_CONFIG.PRICE_SCALE 
            : priceAtCrossing;
          const priceRangeMax = yRange 
            ? resolveBasePrice + (cellSize / 2 - yRange.minY) / GAME_CONFIG.PRICE_SCALE 
            : priceAtCrossing;
          
          // INSTANT FEEDBACK: Update UI immediately based on client calculation
          const autoPlaying = isAutoPlayingRef.current;
          bet.status = isWin ? 'won' : 'lost';
          
          // Calculate how close the outcome was
          const cellCenterY = (bet.yIndex + 0.5) * cellSize;
          const priceDistFromCenter = yRange 
            ? Math.min(Math.abs(yRange.minY - cellCenterY), Math.abs(yRange.maxY - cellCenterY))
            : cellSize;
          const wasClose = priceDistFromCenter < cellSize * 0.6;
          
          if (isWin) {
            consecutiveWins++;
            consecutiveLosses = 0;
            
            const winAmount = bet.amount * bet.multiplier;
            
            if (!autoPlaying) {
              onBalanceChange(balanceRef.current + winAmount);
              balanceRef.current += winAmount;
            }
            onTotalWonChange(prev => prev + winAmount - bet.amount);
            
            const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
            const screenX = (col.x - state.offsetX + cellSize / 2) * cameraScale;
            const screenY = (bet.yIndex * cellSize + state.cameraY) * cameraScale;
            onWin({ amount: winAmount, id: bet.id, screenX, screenY });
            playSound('win');
            
            // Chat bubble for win
            const now = Date.now();
            if (now - lastChatTimeRef.current > 1500) {
              let chatCategory: keyof typeof CHAT_MESSAGES;
              if (consecutiveWins >= 3) {
                chatCategory = 'winStreak';
              } else if (bet.multiplier >= 2.0) {
                chatCategory = 'userBigWin';
              } else if (wasClose) {
                chatCategory = 'closeCall';
              } else {
                chatCategory = 'userWin';
              }
              chatBubbleRef.current = {
                message: pickRandomMessage(chatCategory),
                startTime: now,
                duration: CHAT_DURATION,
              };
              lastChatTimeRef.current = now;
            }
          } else {
            consecutiveLosses++;
            consecutiveWins = 0;
            
            if (!autoPlaying) {
              onTotalLostChange(prev => prev + bet.amount);
            }
            playSound('lose');
            
            // Chat bubble for loss
            const now = Date.now();
            if (now - lastChatTimeRef.current > 1500) {
              let chatCategory: keyof typeof CHAT_MESSAGES;
              if (consecutiveLosses >= 3) {
                chatCategory = 'lossStreak';
              } else if (wasClose) {
                chatCategory = 'nearMiss';
              } else if (bet.amount >= 50) {
                chatCategory = 'userBigLoss';
              } else {
                chatCategory = 'userLoss';
              }
              chatBubbleRef.current = {
                message: pickRandomMessage(chatCategory),
                startTime: now,
                duration: CHAT_DURATION,
              };
              lastChatTimeRef.current = now;
            }
          }
          setPendingBetsCount(prev => Math.max(0, prev - 1));
          
          // BACKGROUND: Confirm with server (non-blocking)
          resolveBetOnServer(bet, isWin, priceAtCrossing, priceRangeMin, priceRangeMax);
        }
      }
    };
    
    // Resolve bet on server (async, non-blocking) - confirms optimistic update
    const resolveBetOnServer = async (
      bet: Bet, 
      clientHint: boolean, 
      priceAtCrossing: number,
      priceRangeMin?: number,
      priceRangeMax?: number
    ) => {
      if (!bet.serverId) return;
      
      try {
        const result = await gameAPI.resolveBet(bet.serverId, clientHint, priceAtCrossing, priceRangeMin, priceRangeMax);
        
        if (result.success && result.bet) {
          const serverBet = result.bet;
          const serverIsWin = serverBet.status === 'won';
          const clientWasWin = bet.status === 'won';
          
          // Check if server disagrees with our optimistic update
          if (serverIsWin !== clientWasWin) {
            console.warn('[Bet] Server correction:', { 
              betId: bet.id, 
              clientSaid: bet.status, 
              serverSays: serverBet.status 
            });
            
            // Correct the optimistic update
          bet.status = serverBet.status as 'won' | 'lost';
            const autoPlaying = isAutoPlayingRef.current;
          
            if (serverIsWin && !clientWasWin) {
              // We said loss, server says win - add winnings
            const winAmount = serverBet.actualWin;
              if (!autoPlaying) {
                onBalanceChange(balanceRef.current + winAmount);
                balanceRef.current += winAmount;
              }
              onTotalWonChange(prev => prev + winAmount);
              onTotalLostChange(prev => prev - bet.amount);
            playSound('win');
            } else if (!serverIsWin && clientWasWin) {
              // We said win, server says loss - remove winnings
              const expectedWin = bet.amount * bet.multiplier;
              if (!autoPlaying) {
                onBalanceChange(balanceRef.current - expectedWin);
                balanceRef.current -= expectedWin;
              }
              onTotalWonChange(prev => prev - expectedWin + bet.amount);
              onTotalLostChange(prev => prev + bet.amount);
            }
          }
          
          // Sync balance with server periodically (every 10th resolution)
          if (Math.random() < 0.1) {
            const balanceData = await gameAPI.getBalance();
            if (balanceData?.user) {
              onBalanceChange(balanceData.user.gemsBalance);
              balanceRef.current = balanceData.user.gemsBalance;
            }
          }
        }
      } catch (error) {
        // Network error - optimistic update stands, will reconcile on next balance sync
        console.error('Failed to confirm bet resolution:', error);
      }
    };

    // TIME-NORMALIZED: Track last volatility sample time for consistent sampling
    let lastVolatilitySampleTime = 0;
    const VOLATILITY_SAMPLE_INTERVAL_MS = 50; // Sample every 50ms regardless of framerate
    
    // SAME-ROW DETECTION: Prevent horizontal line wins by tracking Y cell position
    // If price stays in the same row too long, STOP the grid completely
    let lastYCellIndex: number | null = null;
    let sameRowStartTime = 0;
    let sameRowColumnsAdvanced = 0; // Track how many columns we've moved while in same row
    const MAX_SAME_ROW_COLUMNS = 2; // Stop grid after passing 2 columns in same row
    const SAME_ROW_SPEED_PENALTY = 0.1; // Severe speed reduction when stuck in same row
    
    // DIRECTION TRACKING: Detect sideways consolidation (high volume, flat price)
    let lastDirectionChangePrice = 0;
    let lastDirection: 'up' | 'down' | null = null;
    let directionChanges = 0;
    let directionChangeResetTime = 0;
    const DIRECTION_CHANGE_WINDOW_MS = 3000; // Track direction changes over 3 seconds
    const MIN_DIRECTION_CHANGE = 0.001; // Minimum price change to count as direction change
    
    const calculateVolatility = (currentPrice: number, now: number): number => {
      const state = stateRef.current;
      
      // SAME-ROW TRACKING: Check if price is in the same Y cell as before
      // This is the KEY to preventing horizontal line wins
      const currentYCell = Math.floor(state.priceY / cellSize);
      
      if (lastYCellIndex === null) {
        lastYCellIndex = currentYCell;
        sameRowStartTime = now;
        sameRowColumnsAdvanced = 0;
      } else if (currentYCell !== lastYCellIndex) {
        // Price changed rows! Reset tracking and allow movement
        lastYCellIndex = currentYCell;
        sameRowStartTime = now;
        sameRowColumnsAdvanced = 0;
      }
      
      // Calculate how many columns we've advanced while in the same row
      // This is based on accumulated offset movement
      const columnWidth = cellSize;
      sameRowColumnsAdvanced = Math.floor((state.offsetX - (sameRowStartTime > 0 ? 0 : state.offsetX)) / columnWidth);
      
      // TIME-NORMALIZED: Only sample price at fixed time intervals
      if (now - lastVolatilitySampleTime >= VOLATILITY_SAMPLE_INTERVAL_MS) {
        state.recentPrices.push(currentPrice);
        lastVolatilitySampleTime = now;
        
        if (state.recentPrices.length > GAME_CONFIG.FLATLINE_WINDOW) {
          state.recentPrices.shift();
        }
        
        // DIRECTION CHANGE TRACKING: Detect sideways/consolidation patterns
        if (now - directionChangeResetTime > DIRECTION_CHANGE_WINDOW_MS) {
          directionChanges = Math.floor(directionChanges * 0.5);
          directionChangeResetTime = now;
        }
        
        const priceDelta = currentPrice - lastDirectionChangePrice;
        if (Math.abs(priceDelta) > MIN_DIRECTION_CHANGE) {
          const currentDirection = priceDelta > 0 ? 'up' : 'down';
          if (lastDirection !== null && currentDirection !== lastDirection) {
            directionChanges++;
          }
          lastDirection = currentDirection;
          lastDirectionChangePrice = currentPrice;
        }
      }
      
      if (state.recentPrices.length < 10) {
        return GAME_CONFIG.GRID_SPEED_ACTIVE;
      }
      
      const minPrice = Math.min(...state.recentPrices);
      const maxPrice = Math.max(...state.recentPrices);
      const priceRange = maxPrice - minPrice;
      
      const firstPrice = state.recentPrices[0];
      const netMovement = Math.abs(currentPrice - firstPrice);
      
      const isConsolidating = directionChanges >= 4 && netMovement < priceRange * 0.3;
      
      // SAME-ROW PENALTY: If we've been in the same row too long, severely slow down
      // This PREVENTS more than 2-3 wins in a horizontal line
      const timeInSameRow = now - sameRowStartTime;
      const sameRowTooLong = timeInSameRow > 1500; // More than 1.5 seconds in same row
      
      if (sameRowTooLong) {
        // Price stuck in same row - apply severe speed penalty
        // The longer we're stuck, the slower we go (approaching stop)
        const stuckFactor = Math.min(timeInSameRow / 5000, 1); // 0 to 1 over 5 seconds
        const penalizedSpeed = GAME_CONFIG.GRID_SPEED_IDLE * (1 - stuckFactor * 0.9);
        setVolatilityLevel('idle');
        return Math.max(penalizedSpeed, 0.005); // Near-zero but not completely stopped
      }
      
      // FLATLINE: Price barely moving at all
      if (priceRange < GAME_CONFIG.FLATLINE_THRESHOLD * 0.4) {
        setVolatilityLevel('idle');
        return GAME_CONFIG.GRID_SPEED_IDLE;
      }
      
      // SIDEWAYS CONSOLIDATION: High volume but price staying flat
      if (isConsolidating || netMovement < GAME_CONFIG.FLATLINE_THRESHOLD * 0.5) {
        setVolatilityLevel('idle');
        return GAME_CONFIG.GRID_SPEED_IDLE;
      }
      
      // LOW VOLATILITY: Small price range
      if (priceRange < GAME_CONFIG.FLATLINE_THRESHOLD) {
        setVolatilityLevel('low');
        return GAME_CONFIG.GRID_SPEED_LOW;
      }
      
      // ACTIVE TRENDING: Price is actually moving in a direction
      setVolatilityLevel('active');
      const trendStrength = netMovement / priceRange;
      const rangeMultiplier = Math.min(priceRange / 0.008, 1);
      const effectiveMultiplier = rangeMultiplier * (0.5 + trendStrength * 0.5);
      return GAME_CONFIG.GRID_SPEED_LOW + (GAME_CONFIG.GRID_SPEED_ACTIVE - GAME_CONFIG.GRID_SPEED_LOW) * effectiveMultiplier;
    };

    const updatePhysics = () => {
      const currentPrice = priceRef.current;
      if (currentPrice === null) return;
      
      const state = stateRef.current;
      const width = canvas.width;
      const now = Date.now();
      const timeSinceLastFrame = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;
      
      // DELTA TIME NORMALIZATION: Calculate time factor for frame-independent physics
      // Clamp to prevent huge jumps on slow frames (max 3x normal speed)
      const deltaTime = Math.min(timeSinceLastFrame, TARGET_FRAME_MS * 3) / TARGET_FRAME_MS;

      if (basePriceRef.current === null) {
        basePriceRef.current = currentPrice;
        state.lastPrice = currentPrice;
        state.priceY = cellSize / 2;
        state.targetPriceY = cellSize / 2;
      }

      // Detect if we're returning from a hidden tab (frame gap > 500ms)
      const wasTabHidden = timeSinceLastFrame > 500;
      
      // Check if there are active bets - if so, DON'T reset basePrice
      // This prevents the coordinate system from shifting under active bets
      const hasActiveBets = state.bets.some(b => b.status === 'pending' || b.status === 'placing');
      
      if (wasTabHidden && !hasActiveBets) {
        // Tab was hidden and NO active bets - safe to snap to current price
        // This prevents manipulation and visual spikes
        basePriceRef.current = currentPrice;
        state.priceY = cellSize / 2;
        state.targetPriceY = cellSize / 2;
        state.recentPrices = []; // Reset volatility calculation
        state.lastPrice = currentPrice;
        
        // Clear the price history gap
        const lastPoint = state.priceHistory[state.priceHistory.length - 1];
        if (lastPoint) {
          // Add a gap marker or just continue from current position
          state.priceHistory.push({ x: state.offsetX + headX, y: state.priceY });
        }
      } else if (wasTabHidden && hasActiveBets) {
        // Tab was hidden but we have active bets - DON'T reset basePrice
        // Just reset volatility and continue from where we were
        state.recentPrices = [];
        // Let the price smoothly catch up instead of jumping
      }

      const targetSpeed = calculateVolatility(currentPrice, now);
      // TIME-NORMALIZED: Speed smoothing and movement scaled by deltaTime
      const speedSmoothing = 1 - Math.pow(0.98, deltaTime);
      state.currentSpeed += (targetSpeed - state.currentSpeed) * speedSmoothing;
      state.offsetX += state.currentSpeed * deltaTime;

      const rightEdge = state.offsetX + width;
      if (state.lastGenX < rightEdge + cellSize * 2) {
        generateColumn(state.lastGenX + cellSize, state.priceY);
      }

      const priceDelta = currentPrice - basePriceRef.current;
      state.targetPriceY = -priceDelta * GAME_CONFIG.PRICE_SCALE + cellSize / 2;
      
      // TIME-NORMALIZED: Use time-based exponential smoothing for consistent movement
      // Use faster smoothing if the gap is large (catch up quicker)
      const diff = state.targetPriceY - state.priceY;
      const baseSmoothingFactor = Math.abs(diff) > cellSize * 3 
        ? 0.3  // Fast catch-up for large gaps
        : GAME_CONFIG.PRICE_SMOOTHING;
      // Convert per-frame smoothing to time-based: 1 - (1 - factor)^deltaTime
      const smoothing = 1 - Math.pow(1 - baseSmoothingFactor, deltaTime);
      state.priceY += diff * smoothing;
      
      // ========== HOUSE EDGE: BET AVOIDANCE ==========
      // Gentle repulsion from nearby pending bets
      // This makes the game slightly harder without being unfair
      
      let avoidanceForce = 0;
      const currentWorldXForAvoid = state.offsetX + headX;
      
      for (const bet of state.bets) {
        if (bet.status !== 'pending' && bet.status !== 'placing') continue;
        
        const col = state.columns.find(c => c.id === bet.colId);
        if (!col) continue;
        
        // Only consider bets 1-4 columns ahead
        const columnsAhead = (col.x - currentWorldXForAvoid) / cellSize;
        if (columnsAhead < 0.5 || columnsAhead > 4) continue;
        
        // Calculate vertical distance to bet cell
        const betCenterY = bet.yIndex * cellSize + cellSize / 2;
        const distY = state.priceY - betCenterY;
        const absDistY = Math.abs(distY);
        
        // Only apply avoidance if price is close to the bet (within 2 cells)
        if (absDistY < cellSize * 2) {
          // Repulsion strength: stronger when closer, weaker when further
          // Proximity factor: 1 when on top of bet, 0 when 2 cells away
          const proximityFactor = 1 - (absDistY / (cellSize * 2));
          // Distance factor: stronger for bets that are closer (about to be crossed)
          const distanceFactor = 1 - (columnsAhead / 4);
          
          // Repulsion direction: push away from bet center
          const repulsionDir = distY > 0 ? 1 : -1;
          
          // Force: ~10% of cell size per nearby bet
          const forceStrength = proximityFactor * distanceFactor * cellSize * 0.10;
          avoidanceForce += repulsionDir * forceStrength;
        }
      }
      
      // Cap total avoidance at 20% of cell size
      avoidanceForce = Math.max(-cellSize * 0.20, Math.min(cellSize * 0.20, avoidanceForce));
      
      // Apply avoidance to price position
      state.priceY += avoidanceForce * deltaTime;
      
      // ========== END HOUSE EDGE ==========
      
      const currentWorldX = state.offsetX + headX;
      
      const lastPoint = state.priceHistory[state.priceHistory.length - 1];
      if (!lastPoint || currentWorldX - lastPoint.x > 0.5) {
        state.priceHistory.push({ x: currentWorldX, y: state.priceY });
      }
      
      if (state.priceHistory.length > 5000) {
        state.priceHistory.shift();
      }

      // Use virtual height for camera centering (accounts for mobile zoom-out)
      const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
      const virtualHeight = canvas.height / cameraScale;
      const targetCameraY = -state.priceY + virtualHeight / 2;
      // TIME-NORMALIZED: Camera smoothing scaled by deltaTime
      const cameraSmoothing = 1 - Math.pow(0.98, deltaTime);
      state.cameraY += (targetCameraY - state.cameraY) * cameraSmoothing;

      state.lastPrice = currentPrice;
      checkBets(currentWorldX, state.priceY);
      
      // === CHAT BUBBLES: Price action personality ===
      // Track price movements over time
      priceMovementTrackerRef.current.push({ price: currentPrice, time: now });
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
        const isBigMove = Math.abs(priceChange) > 0.08;
        const isMediumMove = Math.abs(priceChange) > 0.025;
        const isFlat = Math.abs(priceChange) < 0.01;
        
        let category: keyof typeof CHAT_MESSAGES | null = null;
        let message: string | null = null;
        let shouldSpeak = false;
        
        // Track if we're seeing movement
        if (isMediumMove) {
          lastSignificantMoveTime = now;
          priceWasFlat = false;
          flatStartTime = 0;
        } else if (isFlat && !priceWasFlat) {
          priceWasFlat = true;
          flatStartTime = now;
        }
        
        const timeSinceMovement = now - lastSignificantMoveTime;
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
      
      // === SPECIAL CELLS: Generate every 30 seconds ===
      const SPECIAL_CELL_INTERVAL = 30000; // 30 seconds
      const timeSinceLastSpecial = now - state.lastSpecialCellTime;
      
      if (timeSinceLastSpecial >= SPECIAL_CELL_INTERVAL && state.columns.length > 0) {
        // Find a column ahead of current position (10-20 columns ahead)
        const targetX = state.offsetX + headX + cellSize * (15 + Math.random() * 10);
        const targetCol = state.columns.find(c => c.x >= targetX);
        
        if (targetCol) {
          // Place it far from center (4-8 cells away from current price)
          const currentCenterY = Math.floor(state.priceY / cellSize);
          const offsetDirection = Math.random() > 0.5 ? 1 : -1;
          const offsetAmount = 4 + Math.floor(Math.random() * 5); // 4-8 cells away
          const specialYIndex = currentCenterY + offsetDirection * offsetAmount;
          
          // Create special cell
          const specialCell: SpecialCell = {
            id: `special-${Date.now()}`,
            colId: targetCol.id,
            yIndex: specialYIndex,
            createdAt: now,
            bonusMultiplier: 2.0, // 2x bonus!
          };
          
          if (!state.specialCells) state.specialCells = [];
          state.specialCells.push(specialCell);
          state.lastSpecialCellTime = now;
          
          console.log('[Special Cell] Created at column', targetCol.id, 'yIndex', specialYIndex);
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
      const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
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
      // Font sizes - larger for better readability
      ctx.font = `${isMobile ? 18 : 14}px "JetBrains Mono", "SF Mono", monospace`;
      
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
        const minBetColumns = isMobile ? GAME_CONFIG.MIN_BET_COLUMNS_AHEAD_MOBILE : GAME_CONFIG.MIN_BET_COLUMNS_AHEAD;
        const isBettable = col.x > currentHeadX + cellSize * minBetColumns;

        // Smooth animation timing
        const animTime = now * 0.001; // Seconds
        
        Object.entries(col.cells).forEach(([yIdx]) => {
          const yIndex = parseInt(yIdx);
          const y = yIndex * cellSize;
          if (y < startY || y > endY) return;

          // Check if this cell is being hovered
          const isHovered = hoverCellRef.current?.colId === col.id && 
                           hoverCellRef.current?.yIndex === yIndex;
          
          // Check if there's already a bet on this cell
          const hasBet = state.bets.some(b => b.colId === col.id && b.yIndex === yIndex);
          if (hasBet) return;

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
            
            // Bubble ring
            ctx.strokeStyle = `rgba(0, 255, 255, ${0.2 + breathe * 0.15})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(centerX, centerY, bubbleSize - 2, 0, Math.PI * 2);
            ctx.stroke();
            
            // Sparkle highlight on bubble
            const sparkleAngle = animTime * 2 + cellSeed * 10;
            const sparkleX = centerX + Math.cos(sparkleAngle) * bubbleSize * 0.5;
            const sparkleY = centerY + Math.sin(sparkleAngle) * bubbleSize * 0.3 - bubbleSize * 0.2;
            ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + breathe * 0.3})`;
            ctx.beginPath();
            ctx.arc(sparkleX, sparkleY, 2 + breathe, 0, Math.PI * 2);
            ctx.fill();
            
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
          const mult = parseFloat(dynamicMultiplier);
          
          if (isBettable) {
            const textPulse = Math.sin(animTime * 3 + cellSeed * 5) * 0.5 + 0.5;
            ctx.fillStyle = isHovered 
              ? '#ffffff' 
              : `rgba(150, 255, 220, ${0.6 + textPulse * 0.2})`;
            ctx.font = isHovered 
              ? `bold ${isMobile ? 20 : 15}px "JetBrains Mono", monospace`
              : `${isMobile ? 18 : 13}px "JetBrains Mono", monospace`;
          } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.font = `${isMobile ? 16 : 12}px "JetBrains Mono", monospace`;
          }
          ctx.fillText(`${dynamicMultiplier}X`, screenX + cellSize / 2, y + cellSize / 2);
        });
      }

      // Bet animation timing
      const betAnimTime = now * 0.001;
      
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
        
        // Unique seed for this bet's animations
        const betSeed = parseInt(bet.id, 36) % 100 / 100;
        const pulse = Math.sin(betAnimTime * 4 + betSeed * Math.PI * 2) * 0.5 + 0.5;
        
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
        
        // Win zone indicator (simple cyan corners - minimal rendering cost)
        if (bet.winPriceMin !== undefined && bet.winPriceMax !== undefined && bet.basePriceAtBet !== undefined && bet.status === 'pending') {
          const winYTop = -(bet.winPriceMax - bet.basePriceAtBet) * GAME_CONFIG.PRICE_SCALE + cellSize / 2;
          const winYBottom = -(bet.winPriceMin - bet.basePriceAtBet) * GAME_CONFIG.PRICE_SCALE + cellSize / 2;
          
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
          
          // Rainbow hue cycling
          const hue = (animTime * 60 + parseInt(sc.id, 36) % 360) % 360;
          const pulse = Math.sin(animTime * 3) * 0.5 + 0.5;
          
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
          
          // "2X BONUS" text
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${isMobile ? 11 : 9}px sans-serif`;
          ctx.fillText('2X', centerX, centerY - 2);
          ctx.font = `${isMobile ? 8 : 6}px sans-serif`;
          ctx.fillText('BONUS', centerX, centerY + 8);
          
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
          const pixelOffset = i * (priceStep * GAME_CONFIG.PRICE_SCALE);
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
      const speedRatio = state.currentSpeed / GAME_CONFIG.GRID_SPEED_ACTIVE;
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
      state.currentSpeed = GAME_CONFIG.GRID_SPEED_ACTIVE;
      state.lastPrice = null;
      
      for (let x = 0; x < window.innerWidth + 600; x += cellSize) {
        generateColumn(x, cellSize / 2);
      }
    }

    requestRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
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
    setIsDragging(true);
    isDraggingRef.current = true;
    dragBetQueueRef.current = []; // Clear any stale queue
    lastBetCellRef.current = null;
    const rect = canvasRef.current!.getBoundingClientRect();
    // Scale input coordinates for mobile camera zoom-out
    const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
    const screenX = (e.clientX - rect.left) / cameraScale;
    const screenY = (e.clientY - rect.top) / cameraScale;
    placeBetAt(screenX, screenY, true);
  }, [placeBetAt, isMobile]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    // Scale input coordinates for mobile camera zoom-out
    const cameraScale = isMobile ? GAME_CONFIG.MOBILE_CAMERA_SCALE : 1;
    const screenX = (e.clientX - rect.left) / cameraScale;
    const screenY = (e.clientY - rect.top) / cameraScale;
    
    // Track hover position for effects
    const state = stateRef.current;
    const cellSize = Math.floor((isMobile ? GAME_CONFIG.CELL_SIZE_MOBILE : GAME_CONFIG.CELL_SIZE) * zoomLevel);
    const headX = isMobile ? GAME_CONFIG.HEAD_X_MOBILE : GAME_CONFIG.HEAD_X;
    
    const worldX = state.offsetX + screenX;
    const worldY = screenY - state.cameraY;
    mouseWorldPosRef.current = { x: worldX, y: worldY };
    
    // Find hovered cell
    const clickedCol = state.columns.find(col => 
      worldX >= col.x && worldX < col.x + cellSize
    );
    
    if (clickedCol) {
      const yIndex = Math.floor(worldY / cellSize);
      const minBetColumns = isMobile ? GAME_CONFIG.MIN_BET_COLUMNS_AHEAD_MOBILE : GAME_CONFIG.MIN_BET_COLUMNS_AHEAD;
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
    
    // FLUSH DRAG BET QUEUE - Send all queued bets in one batch
    const queue = dragBetQueueRef.current;
    if (queue.length > 0 && isAuthenticated) {
      dragBetQueueRef.current = []; // Clear queue immediately
      
      try {
        const result = await gameAPI.placeBetBatch({
          sessionId: sessionIdRef.current,
          bets: queue.map(q => ({
            columnId: q.columnId,
            yIndex: q.yIndex,
            basePrice: q.basePrice,
            cellSize: q.cellSize,
            amount: q.amount,
            multiplier: q.multiplier,
          })),
        });
        
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
              bet.winPriceMin = betResult.winPriceMin;
              bet.winPriceMax = betResult.winPriceMax;
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
      } catch {
        // Network error - refund all queued bets
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
        onError?.('Network error - bets cancelled');
      }
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
    setZoomIndex(prev => (prev + 1) % GAME_CONFIG.ZOOM_LEVELS.length);
  }, [isMobile]);

  return {
    canvasRef,
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
  };
}

