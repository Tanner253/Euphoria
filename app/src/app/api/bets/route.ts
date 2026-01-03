import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { User, Bet, Transaction } from '@/lib/models';
import { GAME_CONFIG, calculateMultiplier, getYIndex } from '@/lib/game/config';
import crypto from 'crypto';

// Server-side odds signing secret (in production, use env var)
const ODDS_SECRET = process.env.ODDS_SECRET || 'demo-secret-change-in-production';

/**
 * Generate a signed odds token to prevent client manipulation
 */
function generateOddsSignature(oddsId: string, multiplier: number, columnX: number, cellYIndex: number): string {
  const data = `${oddsId}:${multiplier}:${columnX}:${cellYIndex}`;
  return crypto.createHmac('sha256', ODDS_SECRET).update(data).digest('hex');
}

/**
 * Verify odds signature
 */
function verifyOddsSignature(oddsId: string, multiplier: number, columnX: number, cellYIndex: number, signature: string): boolean {
  const expected = generateOddsSignature(oddsId, multiplier, columnX, cellYIndex);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * POST /api/bets
 * Place a new bet
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      walletAddress, 
      amount, 
      columnX, 
      cellYIndex, 
      currentPrice,
      currentWorldX,
      oddsId,
      oddsSignature,
    } = body;
    
    // Validate required fields
    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }
    
    if (!amount || typeof amount !== 'number' || amount < GAME_CONFIG.MIN_BET) {
      return NextResponse.json({ error: `Minimum bet is ${GAME_CONFIG.MIN_BET} gems` }, { status: 400 });
    }
    
    if (amount > GAME_CONFIG.MAX_BET) {
      return NextResponse.json({ error: `Maximum bet is ${GAME_CONFIG.MAX_BET} gems` }, { status: 400 });
    }
    
    if (typeof columnX !== 'number' || typeof cellYIndex !== 'number') {
      return NextResponse.json({ error: 'Invalid grid position' }, { status: 400 });
    }
    
    if (typeof currentPrice !== 'number' || currentPrice <= 0) {
      return NextResponse.json({ error: 'Invalid current price' }, { status: 400 });
    }
    
    if (typeof currentWorldX !== 'number') {
      return NextResponse.json({ error: 'Invalid world position' }, { status: 400 });
    }
    
    // Verify bet is far enough ahead
    const distanceAhead = columnX - currentWorldX;
    const minDistance = GAME_CONFIG.MIN_BET_DISTANCE_COLUMNS * GAME_CONFIG.CELL_WIDTH;
    
    if (distanceAhead < minDistance) {
      return NextResponse.json({ error: 'Bet must be placed further ahead' }, { status: 400 });
    }
    
    const normalizedAddress = walletAddress.toLowerCase().trim();
    
    await connectToDatabase();
    
    // Find user and verify balance
    const user = await User.findOne({ walletAddress: normalizedAddress });
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    if (user.balance < amount) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
    }
    
    // Calculate multiplier server-side (authoritative)
    const currentPriceYIndex = getYIndex(0); // Base at 0, price moves relative
    const serverMultiplier = calculateMultiplier(cellYIndex, currentPriceYIndex);
    
    // If client provided signed odds, verify them (optional extra security)
    let finalMultiplier = serverMultiplier;
    if (oddsId && oddsSignature) {
      // Client got pre-signed odds from /api/odds endpoint
      // Verify and use those if valid
      // For now, we just use server-calculated multiplier
    }
    
    const potentialPayout = amount * finalMultiplier;
    
    // Calculate price targets for this cell
    // Cell covers Y range: [cellYIndex * CELL_HEIGHT, (cellYIndex + 1) * CELL_HEIGHT]
    // We need to convert back to price targets
    const cellYMin = cellYIndex * GAME_CONFIG.CELL_HEIGHT;
    const cellYMax = (cellYIndex + 1) * GAME_CONFIG.CELL_HEIGHT;
    
    // For now, store as Y coordinates. In production, convert to actual price targets.
    const targetPriceMin = cellYMin;
    const targetPriceMax = cellYMax;
    
    // Deduct bet amount from balance
    const balanceBefore = user.balance;
    const balanceAfter = balanceBefore - amount;
    
    user.balance = balanceAfter;
    user.totalWagered += amount;
    await user.save();
    
    // Create bet record
    const newOddsId = crypto.randomUUID();
    const newOddsSignature = generateOddsSignature(newOddsId, finalMultiplier, columnX, cellYIndex);
    
    const bet = await Bet.create({
      user: user._id,
      walletAddress: normalizedAddress,
      amount,
      multiplier: finalMultiplier,
      potentialPayout,
      columnX,
      cellYIndex,
      priceAtBet: currentPrice,
      targetPriceMin,
      targetPriceMax,
      resolveAtWorldX: columnX + GAME_CONFIG.CELL_WIDTH,
      status: 'pending',
      payout: 0,
      oddsId: newOddsId,
      oddsSignature: newOddsSignature,
    });
    
    // Create transaction record
    await Transaction.create({
      user: user._id,
      walletAddress: normalizedAddress,
      type: 'bet',
      amount: -amount,
      balanceBefore,
      balanceAfter,
      status: 'completed',
      betId: bet._id,
      description: `Bet ${amount} gems at ${finalMultiplier.toFixed(2)}x`,
    });
    
    return NextResponse.json({
      success: true,
      bet: {
        id: bet._id.toString(),
        amount,
        multiplier: finalMultiplier,
        potentialPayout,
        columnX,
        cellYIndex,
        status: 'pending',
      },
      newBalance: balanceAfter,
    });
  } catch (error) {
    console.error('Bet placement error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/bets?wallet=<address>&status=<pending|won|lost>
 * Get user's bets
 */
export async function GET(request: NextRequest) {
  try {
    const walletAddress = request.nextUrl.searchParams.get('wallet');
    const status = request.nextUrl.searchParams.get('status');
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');
    
    if (!walletAddress) {
      return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
    }
    
    const normalizedAddress = walletAddress.toLowerCase().trim();
    
    await connectToDatabase();
    
    const query: Record<string, unknown> = { walletAddress: normalizedAddress };
    if (status) {
      query.status = status;
    }
    
    const bets = await Bet.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    return NextResponse.json({
      bets: bets.map(bet => ({
        id: bet._id.toString(),
        amount: bet.amount,
        multiplier: bet.multiplier,
        potentialPayout: bet.potentialPayout,
        columnX: bet.columnX,
        cellYIndex: bet.cellYIndex,
        status: bet.status,
        payout: bet.payout,
        createdAt: bet.createdAt,
        resolvedAt: bet.resolvedAt,
      })),
    });
  } catch (error) {
    console.error('Bets fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

