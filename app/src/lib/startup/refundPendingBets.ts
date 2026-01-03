/**
 * Server Startup - Refund Pending Bets
 * 
 * Automatically refunds all pending bets when the server restarts.
 * This ensures users don't lose their gems from bets that were
 * interrupted by a server restart/rebuild.
 */

import { BetService } from '@/lib/db/services';

// How old a bet must be to auto-refund (in minutes)
// Set to 0 to refund ALL pending bets on startup
const AUTO_REFUND_AGE_MINUTES = 0;

export async function refundPendingBetsOnStartup(): Promise<void> {
  // Small delay to ensure database connection is ready
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('💎 Checking for pending bets to refund...');
  
  try {
    const betService = BetService.getInstance();
    
    // Get all pending bets
    const pendingBets = await betService.getAllBets({ status: 'pending' });
    
    if (pendingBets.length === 0) {
      console.log('✅ No pending bets to refund');
      return;
    }
    
    console.log(`📋 Found ${pendingBets.length} pending bets`);
    
    let refundedCount = 0;
    let totalRefunded = 0;
    
    for (const bet of pendingBets) {
      // Check if bet is old enough to refund
      const ageMinutes = (Date.now() - new Date(bet.createdAt).getTime()) / (1000 * 60);
      
      if (AUTO_REFUND_AGE_MINUTES === 0 || ageMinutes >= AUTO_REFUND_AGE_MINUTES) {
        try {
          const cancelled = await betService.cancelBet(
            bet._id!.toString(),
            'Server restart - bet refunded automatically'
          );
          
          if (cancelled) {
            refundedCount++;
            totalRefunded += bet.amount;
            console.log(`  💰 Refunded ${bet.amount} gems to ${bet.walletAddress.slice(0, 8)}...`);
          }
        } catch (err) {
          console.error(`  ❌ Failed to refund bet ${bet._id}:`, (err as Error).message);
        }
      }
    }
    
    console.log(`✅ Refunded ${refundedCount} bets (${totalRefunded} total gems)`);
    
  } catch (error) {
    // Don't crash the server if refund fails
    console.error('❌ Error refunding pending bets:', error);
  }
}

