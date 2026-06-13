import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "zk-ML Agent Vault — Verifiable DeFi Rebalancing",
  description: "A DeFi vault managed by a ZK-verified ML classifier running inside the SP1 zkVM. Real model inference with simulated proof generation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
