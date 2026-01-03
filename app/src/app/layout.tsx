import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/contexts/WalletContext";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Euphoria | Solana Prediction Market",
  description: "Real-time prediction market game powered by live Solana price action",
  keywords: ["solana", "prediction market", "crypto", "trading", "game"],
  openGraph: {
    title: "Euphoria | Solana Prediction Market",
    description: "Real-time prediction market game powered by live Solana price action",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} font-sans antialiased bg-black text-white`}
        suppressHydrationWarning
      >
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
