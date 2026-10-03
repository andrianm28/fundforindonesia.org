"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { activeHref, NAV_ACTIVE, NAV_IDLE } from "@/lib/navActive";

const ADMIN_HREFS = [
  "/admin", "/admin/users", "/admin/campaigns", "/admin/payouts", "/admin/refunds",
  "/admin/manual-contributions", "/admin/abuse-thresholds", "/admin/campaigns/lifecycle",
  "/admin/volunteer-trips", "/admin/dormant-balances", "/admin/verification-checklist",
  "/admin/collecting-entities", "/admin/partnership-inquiries", "/admin/payment-providers",
] as const;
const LINK_BASE = "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors";

/**
 * The Admin navigation. From the `md` breakpoint up it is the always-visible
 * 256px sidebar; below that it folds behind a menu button so the page content
 * keeps the full phone width (UAT round 1: at 390px the sidebar squeezed the
 * content and the page scrolled sideways). The brand title is a <p>, not an
 * <h1>: every /admin page owns exactly one h1 of its own.
 */
export function AdminSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const current = activeHref(pathname, ADMIN_HREFS);

  // The folded menu closes after navigating to another page.
  const [seenPathname, setSeenPathname] = useState(pathname);
  if (pathname !== seenPathname) {
    setSeenPathname(pathname);
    setOpen(false);
  }

  return (
    <div className="md:w-64 md:shrink-0">
      <div className="flex items-center justify-between border-b border-border bg-bg px-4 py-3 md:hidden">
        <p className="text-base font-bold text-ink">Admin Panel</p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="admin-sidebar"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text"
        >
          {open ? "Tutup menu" : "Buka menu"}
        </button>
      </div>

      <aside
        id="admin-sidebar"
        className={`${open ? "flex" : "hidden"} flex-col border-r border-border bg-bg md:sticky md:top-0 md:flex md:min-h-screen`}
      >
      <div className="hidden border-b border-border p-6 md:block">
        <p className="text-xl font-bold text-ink">Admin Panel</p>
        <p className="text-sm text-text-secondary mt-1">Manajemen Platform</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        <SidebarLink current={current} href="/admin" icon="dashboard">
          Dashboard
        </SidebarLink>
        <SidebarLink current={current} href="/admin/users" icon="users">
          Pengguna
        </SidebarLink>
        <SidebarLink current={current} href="/admin/campaigns" icon="campaigns">
          Kampanye
        </SidebarLink>
        <SidebarLink current={current} href="/admin/payouts" icon="payouts">
          Pencairan Dana
        </SidebarLink>
        <SidebarLink current={current} href="/admin/refunds" icon="refund">
          Refund
        </SidebarLink>
        <SidebarLink current={current} href="/admin/manual-contributions" icon="manual-contribution">
          Manual Contribution
        </SidebarLink>
        <SidebarLink current={current} href="/admin/abuse-thresholds" icon="threshold">
          Ambang Penyalahgunaan
        </SidebarLink>
        <SidebarLink current={current} href="/admin/campaigns/lifecycle" icon="flag">
          Suspension &amp; Cancellation
        </SidebarLink>
        <SidebarLink current={current} href="/admin/volunteer-trips" icon="flag">
          Volunteer Trip
        </SidebarLink>
        <SidebarLink current={current} href="/admin/dormant-balances" icon="dormant">
          Dormant Balance
        </SidebarLink>
        <SidebarLink current={current} href="/admin/verification-checklist" icon="checklist">
          Checklist Verifikasi
        </SidebarLink>
        <SidebarLink current={current} href="/admin/collecting-entities" icon="campaigns">
          Collecting Entity
        </SidebarLink>
        <SidebarLink current={current} href="/admin/partnership-inquiries" icon="campaigns">
          Partnership Inquiry
        </SidebarLink>
        <SidebarLink current={current} href="/admin/payment-providers" icon="payouts">
          Penyedia Pembayaran
        </SidebarLink>
      </nav>

      <div className="p-4 border-t border-border">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-text hover:text-primary transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Kembali ke Beranda
        </Link>
      </div>
      </aside>
    </div>
  );
}

function SidebarLink({
  href,
  icon,
  current,
  children,
}: {
  href: string;
  current: string | null;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current === href ? "page" : undefined}
      className={`${LINK_BASE} ${current === href ? NAV_ACTIVE : NAV_IDLE}`}
    >
      <SidebarIcon type={icon} />
      {children}
    </Link>
  );
}

function SidebarIcon({ type }: { type: string }) {
  switch (type) {
    case "dashboard":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      );
    case "users":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      );
    case "campaigns":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
      );
    case "checklist":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
      );
    case "flag":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 3v18M3 4h14l-3 4 3 4H3"
          />
        </svg>
      );
    case "payouts":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      );
    case "refund":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 14l-4-4m0 0l4-4m-4 4h11a4 4 0 010 8h-1"
          />
        </svg>
      );
    case "manual-contribution":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 2v8m0 0v2m0-2c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case "dormant":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case "threshold":
      return (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          />
        </svg>
      );
    default:
      return null;
  }
}
