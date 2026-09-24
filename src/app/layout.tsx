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
