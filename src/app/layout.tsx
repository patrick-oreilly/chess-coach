import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Mono, STIX_Two_Text } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const stixSerif = STIX_Two_Text({
  variable: "--font-serif",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "1.F4 // CHESS COACH — Swiss Brutalist Game Analyzer & Blunder Trainer",
  description:
    "Local Stockfish + DeepSeek game analyzer, personal spaced-repetition blunder trainer, and Bird's Opening / Pirc leak finder.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${geistSans.variable} ${geistMono.variable} ${stixSerif.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-paper text-ink">{children}</body>
    </html>
  );
}
