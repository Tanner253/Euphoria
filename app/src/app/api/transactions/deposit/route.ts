/**
 * POST /api/transactions/deposit
 * Create a deposit after user sends SOL to custodial wallet
 * 
 * SECURITY: Verifies transaction on-chain before crediting gems
 */

import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { getAuthenticatedWallet } from '@/lib/auth/jwt';
import { TransactionService } from '@/lib/db/services';
import logger from '@/lib/utils/secureLogger';

/**
 * Verify a deposit transaction on-chain
 * Returns the actual SOL amount sent to custodial wallet
 */
async function verifyDepositOnChain(
  txSignature: string,
  fromWallet: string,
  custodialAddress: string
): Promise<{ 
  valid: boolean; 
  lamports?: number; 
  error?: string;
  blockTime?: number;
  slot?: number;
}> {
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Get transaction details
    const tx = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });
    
    if (!tx) {
      return { valid: false, error: 'Transaction not found on chain' };
    }
    
    if (tx.meta?.err) {
      return { valid: false, error: 'Transaction failed on chain' };
    }
    
    // Verify the transaction sends SOL to custodial wallet
    const instructions = tx.transaction.message.instructions;
    let depositAmount = 0;
    let foundValidTransfer = false;
    
    for (const instruction of instructions) {
      // Check if it's a system program transfer
      if ('parsed' in instruction && instruction.program === 'system') {
        const parsed = instruction.parsed;
        
        if (parsed.type === 'transfer') {
          const { source, destination, lamports } = parsed.info;
          
          // Verify: FROM = user's wallet, TO = custodial wallet
          if (
            source === fromWallet && 
            destination === custodialAddress
          ) {
            depositAmount += lamports;
            foundValidTransfer = true;
          }
        }
      }
    }
    
    if (!foundValidTransfer) {
      return { 
        valid: false, 
        error: 'Transaction does not transfer SOL to deposit address' 
      };
    }
    
    if (depositAmount <= 0) {
      return { valid: false, error: 'No valid deposit amount found' };
    }
    
    return { 
      valid: true, 
      lamports: depositAmount,
      blockTime: tx.blockTime || undefined,
      slot: tx.slot
    };
    
  } catch (error) {
    logger.error('[Deposit] On-chain verification error', error);
    return { valid: false, error: 'Failed to verify transaction' };
  }
}

// In-flight request tracking to prevent race conditions
const processingDeposits = new Map<string, Promise<NextResponse>>();

/**
 * Check if a transaction has already been processed
 */
async function isTransactionProcessed(txSignature: string): Promise<boolean> {
  const transactionService = TransactionService.getInstance();
  
  // Check our database for this transaction signature
  const existingTx = await transactionService.findBySignature(txSignature);
  return existingTx !== null;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const walletAddress = getAuthenticatedWallet(authHeader);
    
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { txSignature } = body;
    
    if (!txSignature || typeof txSignature !== 'string') {
      return NextResponse.json(
        { error: 'Missing transaction signature' },
        { status: 400 }
      );
    }
    
    // Validate signature format (base58, 87-88 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(txSignature)) {
      return NextResponse.json(
        { error: 'Invalid transaction signature format' },
        { status: 400 }
      );
    }
    
    // RACE CONDITION FIX: Check if this exact request is already being processed
    const existingRequest = processingDeposits.get(txSignature);
    if (existingRequest) {
      logger.info('[Deposit] Duplicate request detected, returning existing promise', {
        wallet: walletAddress.slice(0, 8),
        sig: txSignature.slice(0, 16)
      });
      return existingRequest;
    }
    
    // Create and store the processing promise
    const processPromise = processDeposit(walletAddress, txSignature);
    processingDeposits.set(txSignature, processPromise);
    
    try {
      const result = await processPromise;
      return result;
    } finally {
      // Clean up after processing (with small delay to catch rapid duplicates)
      setTimeout(() => processingDeposits.delete(txSignature), 5000);
    }
    
  } catch (error) {
    logger.error('[API] Deposit error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function processDeposit(walletAddress: string, txSignature: string): Promise<NextResponse> {
  try {
    const transactionService = TransactionService.getInstance();
    const custodialAddress = transactionService.getCustodialWalletAddress();
    
    if (!custodialAddress) {
      return NextResponse.json(
        { error: 'Deposit system not configured' },
        { status: 503 }
      );
    }
    
    // SECURITY: Check if this transaction was already processed (prevent double-credit)
    const alreadyProcessed = await isTransactionProcessed(txSignature);
    if (alreadyProcessed) {
      return NextResponse.json(
        { error: 'This transaction has already been processed' },
        { status: 400 }
      );
    }
    
    // SECURITY: Verify the transaction on-chain
    const verification = await verifyDepositOnChain(
      txSignature,
      walletAddress,
      custodialAddress
    );
    
    if (!verification.valid) {
      logger.warn('[Deposit] Verification failed', { 
        wallet: walletAddress.slice(0, 8),
        reason: verification.error 
      });
      
      return NextResponse.json(
        { error: verification.error || 'Transaction verification failed' },
        { status: 400 }
      );
    }
    
    const solAmount = verification.lamports!;
    
    // Minimum deposit check
    const minDeposit = Number(process.env.MIN_DEPOSIT_LAMPORTS) || 10000000; // 0.01 SOL default
    if (solAmount < minDeposit) {
      return NextResponse.json(
        { error: `Minimum deposit is ${minDeposit / 1e9} SOL` },
        { status: 400 }
      );
    }
    
    // ATOMIC: Create deposit with txSignature (prevents duplicates via unique index)
    const { transaction: deposit, isNew } = await transactionService.createDeposit(
      walletAddress, 
      solAmount,
      txSignature
    );
    
    // If deposit already exists and is confirmed, return success (idempotent)
    if (!isNew && deposit.status === 'confirmed') {
      logger.info('[Deposit] Already processed (idempotent)', { 
        wallet: walletAddress.slice(0, 8),
        sig: txSignature.slice(0, 16)
      });
      
      return NextResponse.json({
        success: true,
        transaction: {
          id: deposit._id?.toString(),
          gemsAmount: deposit.gemsAmount,
          solAmount: deposit.solAmount,
          txSignature,
          status: 'confirmed'
        }
      });
    }
    
    // Confirm the deposit (credit gems to user)
    const confirmed = await transactionService.confirmDeposit(
      deposit._id!.toString(),
      txSignature,
      verification.blockTime || Math.floor(Date.now() / 1000),
      verification.slot || 0
    );
    
    if (!confirmed.success) {
      logger.error('[Deposit] Failed to confirm in database', { 
        wallet: walletAddress.slice(0, 8) 
      });
      
      return NextResponse.json(
        { error: 'Failed to process deposit. Please contact support.' },
        { status: 500 }
      );
    }
    
    logger.info('[Deposit] Confirmed', { 
      wallet: walletAddress.slice(0, 8),
      sol: solAmount / 1e9,
      gems: deposit.gemsAmount
    });
    
    return NextResponse.json({
      success: true,
      transaction: {
        id: deposit._id?.toString(),
        gemsAmount: deposit.gemsAmount,
        solAmount: deposit.solAmount,
        txSignature,
        status: 'confirmed'
      }
    });
    
  } catch (error) {
    logger.error('[API] Deposit processing error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/transactions/deposit
 * Get custodial wallet address for deposits
 */
export async function GET() {
  try {
    const transactionService = TransactionService.getInstance();
    const custodialAddress = transactionService.getCustodialWalletAddress();
    
    if (!custodialAddress) {
      return NextResponse.json(
        { error: 'Custodial wallet not configured' },
        { status: 503 }
      );
    }
    
    return NextResponse.json({
      custodialAddress,
      gemsPerSol: Number(process.env.GEMS_PER_SOL) || 1000,
      minDeposit: (Number(process.env.MIN_DEPOSIT_LAMPORTS) || 10000000) / 1e9 // in SOL
    });
    
  } catch (error) {
    logger.error('[API] Get deposit info error', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
