import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import { Providers } from "@/components/layout/Providers";
import { AppShell } from "@/components/layout/AppShell";
import { ConditionalFooter } from "@/components/layout/ConditionalFooter";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Fund for Indonesia - Platform Donasi dan Penggalangan Dana Online",
  description:
    "Fund for Indonesia adalah platform teknologi untuk donasi dan penggalangan dana online terpercaya di Indonesia.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          <AppShell>{children}</AppShell>
          <ConditionalFooter />
        </Providers>
      </body>
    </html>
  );
}
