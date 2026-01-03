import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { User, Bet, Transaction } from '@/lib/models';
import { GAME_CONFIG } from '@/lib/game/config';

/**
 * POST /api/bets/resolve
 * Resolve pending bets based on current game state
 * 
 * This endpoint is called by the client when bets need resolution.
 * In production, this should be a server-side cron job or triggered by the price service.
 */
export async function POST(request: NextRequest) {
  try {
    const { currentWorldX, priceY, walletAddress } = await request.json();
    
    if (typeof currentWorldX !== 'number' || typeof priceY !== 'number') {
      return NextResponse.json({ error: 'Invalid game state' }, { status: 400 });
    }
    
    await connectToDatabase();
    
    // Find pending bets that should be resolved
    const query: Record<string, unknown> = {
      status: 'pending',
      resolveAtWorldX: { $lte: currentWorldX },
    };
    
    if (walletAddress) {
      query.walletAddress = walletAddress.toLowerCase().trim();
    }
    
    const pendingBets = await Bet.find(query).limit(100);
    
    const results: Array<{
      betId: string;
      status: 'won' | 'lost';
      payout: number;
    }> = [];
    
    for (const bet of pendingBets) {
      // Check if price Y is within the bet's cell
      const cellYMin = bet.cellYIndex * GAME_CONFIG.CELL_HEIGHT;
      const cellYMax = (bet.cellYIndex + 1) * GAME_CONFIG.CELL_HEIGHT;
      
      // Determine if bet won
      // The price line should pass through the cell's Y range
      const won = priceY >= cellYMin && priceY < cellYMax;
      
      if (won) {
        // Calculate payout
        const payout = bet.amount * bet.multiplier;
        
        // Update bet
        bet.status = 'won';
        bet.payout = payout;
        bet.resolvedAt = new Date();
        bet.resolvedPrice = priceY;
        await bet.save();
        
        // Credit user balance
        const user = await User.findById(bet.user);
        if (user) {
          const balanceBefore = user.balance;
          const balanceAfter = balanceBefore + payout;
          
          user.balance = balanceAfter;
          user.totalWon += payout;
          await user.save();
          
          // Create win transaction
          await Transaction.create({
            user: user._id,
            walletAddress: bet.walletAddress,
            type: 'win',
            amount: payout,
            balanceBefore,
            balanceAfter,
            status: 'completed',
            betId: bet._id,
            description: `Won ${payout.toFixed(2)} gems (${bet.multiplier.toFixed(2)}x)`,
          });
        }
        
        results.push({
          betId: bet._id.toString(),
          status: 'won',
          payout,
        });
      } else {
        // Bet lost
        bet.status = 'lost';
        bet.payout = 0;
        bet.resolvedAt = new Date();
        bet.resolvedPrice = priceY;
        await bet.save();
        
        results.push({
          betId: bet._id.toString(),
          status: 'lost',
          payout: 0,
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      resolved: results.length,
      results,
    });
  } catch (error) {
    console.error('Bet resolution error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

