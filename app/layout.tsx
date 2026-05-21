import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { WalletProviders } from "@/src/components/wallet/wallet-providers";
import { Toaster } from "@/src/components/toast/Toaster";
import { Analytics } from "@vercel/analytics/react";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Arvexa",
    template: "%s | Arvexa",
  },
  description:
    "Manage, optimize and refinance DeFi positions, smarter. Track collateral and debt across protocols, simulate outcomes before making changes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${ibmPlexMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <WalletProviders>
          {children}
          <Toaster />
          <Analytics />
        </WalletProviders>
      </body>
    </html>
  );
}
