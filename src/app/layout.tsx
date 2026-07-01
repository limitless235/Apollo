import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const satoshi = Inter({
  variable: "--font-satoshi",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Apollo — Manager's Desk",
  description: "Personal NSE/BSE news, charts, and AI research assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${satoshi.variable} ${jetbrains.variable} dark h-full`}>
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}
