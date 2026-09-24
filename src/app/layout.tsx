import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/styles/globals.css";
import { Providers } from "@/components/layout/Providers";
import { AppShell } from "@/components/layout/AppShell";
import { ConditionalFooter } from "@/components/layout/ConditionalFooter";

// Self-hosted, not next/font/google: the Docker build has no reliable route
// to fonts.googleapis.com, so a build-time fetch there is a build that can
// fail for reasons that have nothing to do with this codebase. This is the
// same variable-weight Latin-subset file Google's own CSS would have served
// (fonts.gstatic.com/s/inter/v20/...1ZL7.woff2), vendored once instead of
// fetched on every build.
const inter = localFont({
  src: "../fonts/Inter-Variable.woff2",
  variable: "--font-inter",
  weight: "100 900",
});

// Same self-hosting reasoning as Inter above: no reliable build-time route
// to fonts.googleapis.com. These are the real variable-weight Latin-subset
// files Google's own CSS serves for Newsreader:wght@200..800 and
// JetBrains+Mono:wght@100..800 respectively -- vendored once, not fetched
// per build. This is the Record register (src/lib -- see the Ledger Line
// spec, .scratch/ledger-line-visual-refresh/spec.md): serif for prose that
// is a claim of record, mono for numbers/IDs shown as stated fact. Not yet
// applied to any page content -- that's later tickets' job.
const newsreader = localFont({
  src: "../fonts/Newsreader-Variable.woff2",
  variable: "--font-newsreader",
  weight: "200 800",
});

const jetbrainsMono = localFont({
  src: "../fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
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
      <body className={`${inter.variable} ${newsreader.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>
          <AppShell>{children}</AppShell>
          <ConditionalFooter />
        </Providers>
      </body>
    </html>
  );
}
