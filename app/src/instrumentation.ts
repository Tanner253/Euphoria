/**
 * Next.js Instrumentation - Runs on server startup
 * 
 * This file is automatically loaded by Next.js when the server starts.
 * Used to refund pending bets from previous server session.
 */

// Track if queue processor is running
let queueProcessorInterval: NodeJS.Timeout | null = null;

export async function register() {
  // Only run on server (not edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('🚀 Server starting up...');
    
    // Dynamic import to avoid issues with client-side code
    const { refundPendingBetsOnStartup } = await import('./lib/startup/refundPendingBets');
    
    // Refund pending bets from previous session
    await refundPendingBetsOnStartup();
    
    // Start withdrawal queue processor (development only - use Vercel Cron in production)
    if (process.env.NODE_ENV === 'development' && !queueProcessorInterval) {
      console.log('⏰ Starting withdrawal queue processor (every 30 seconds)...');
      
      const processQueue = async () => {
        try {
          // Only process if there's a custodial wallet configured
          if (!process.env.CUSTODIAL_WALLET_PRIVATE_KEY) return;
          
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          const response = await fetch(`${baseUrl}/api/admin/process-queue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (response.ok) {
            const result = await response.json();
            if (result.processed > 0 || result.failed > 0) {
              console.log(`💸 Queue processed: ${result.processed} completed, ${result.failed} failed`);
            }
          }
        } catch {
          // Silent fail - queue will be processed on next interval
        }
      };
      
      // Process immediately on startup (after a short delay for server to be ready)
      setTimeout(processQueue, 5000);
      
      // Then process every 30 seconds
      queueProcessorInterval = setInterval(processQueue, 30000);
    }
  }
}

