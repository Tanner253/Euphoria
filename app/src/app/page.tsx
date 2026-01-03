'use client';

import dynamic from 'next/dynamic';

// Dynamic import to prevent SSR issues with canvas/WebSocket
const PredictionMarket = dynamic(
  () => import('@/components/PredictionMarket'),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-screen bg-[#0a0014] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          <div className="text-white/50 text-sm font-medium tracking-wider uppercase">
            Loading Euphoria...
          </div>
        </div>
      </div>
    )
  }
);

export default function Home() {
  return (
    <main className="w-full h-screen overflow-hidden">
      <PredictionMarket />
    </main>
  );
}
