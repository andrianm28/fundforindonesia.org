"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeHref, NAV_ACTIVE, NAV_IDLE } from "@/lib/navActive";

type IconType = "dashboard" | "campaign" | "report";
type Item = { href: string; label: string; mobileLabel: string; icon: IconType };

const ITEMS: readonly Item[] = [
  { href: "/moderasi", label: "Dashboard", mobileLabel: "Dashboard", icon: "dashboard" },
  { href: "/moderasi/campaigns", label: "Kampanye", mobileLabel: "Kampanye", icon: "campaign" },
  { href: "/moderasi/reports", label: "Laporan", mobileLabel: "Laporan", icon: "report" },
  { href: "/moderasi/partner-organisations", label: "Partner Organisation", mobileLabel: "Partner", icon: "campaign" },
  { href: "/moderasi/collecting-entities", label: "Collecting Entity", mobileLabel: "Collecting Entity", icon: "campaign" },
  { href: "/moderasi/rekening", label: "Rekening", mobileLabel: "Rekening", icon: "campaign" },
  { href: "/moderasi/kind-authorisations", label: "Kind Authorisation", mobileLabel: "Kind Auth.", icon: "campaign" },
  { href: "/moderasi/volunteer-trips", label: "Volunteer Trip", mobileLabel: "Trip", icon: "campaign" },
];

const HREFS = ITEMS.map((i) => i.href);
const SIDE_LINK = "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors";
const MOBILE_LINK =
  "flex-1 shrink-0 whitespace-nowrap px-3 text-center py-2.5 text-xs font-medium transition-colors";

export function ModerasiSideNav() {
  const current = activeHref(usePathname(), HREFS);
  return (
    <nav className="px-3 space-y-1">
      {ITEMS.map(({ href, label, icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={current === href ? "page" : undefined}
          className={`${SIDE_LINK} ${current === href ? NAV_ACTIVE : NAV_IDLE}`}
        >
          <Icon type={icon} className="w-5 h-5" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function ModerasiMobileNav() {
  const current = activeHref(usePathname(), HREFS);
  return (
    <div className="flex overflow-x-auto border-t border-border">
      {ITEMS.map(({ href, mobileLabel }) => (
        <Link
          key={href}
          href={href}
          aria-current={current === href ? "page" : undefined}
          className={`${MOBILE_LINK} ${current === href ? NAV_ACTIVE : NAV_IDLE}`}
        >
          {mobileLabel}
        </Link>
      ))}
    </div>
  );
}

const PATHS: Record<IconType, string> = {
  dashboard:
    "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  campaign:
    "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  report:
    "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z",
};

function Icon({ type, className }: { type: IconType; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={PATHS[type]} />
    </svg>
  );
}
