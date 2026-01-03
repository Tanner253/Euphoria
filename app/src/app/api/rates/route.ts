/**
 * GET /api/rates
 * Returns conversion rates and fee information
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    gemsPerSol: Number(process.env.GEMS_PER_SOL) || 1000,
    feePercent: (Number(process.env.WITHDRAWAL_FEE_PERCENT) || 0.02) * 100,
    minWithdrawalGems: Number(process.env.MIN_WITHDRAWAL_GEMS) || 100,
    minDepositSol: (Number(process.env.MIN_DEPOSIT_LAMPORTS) || 10000000) / 1e9,
    custodialWallet: process.env.CUSTODIAL_WALLET_ADDRESS || '',
  });
}

