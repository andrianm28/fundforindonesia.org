import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { AdminSidebar } from "./AdminSidebar";

const LEDGER_CLASS = /(text|bg|border)-ledger/;

describe("AdminSidebar", () => {
  it("links every admin index route once in the desktop nav", () => {
    const { container } = render(<AdminSidebar />);
    for (const href of [
      "/admin", "/admin/users", "/admin/campaigns", "/admin/payouts", "/admin/refunds",
      "/admin/manual-contributions", "/admin/abuse-thresholds", "/admin/campaigns/lifecycle",
      "/admin/volunteer-trips", "/admin/dormant-balances", "/admin/verification-checklist",
      "/admin/collecting-entities", "/admin/partnership-inquiries",
    ]) {
      expect(container.querySelectorAll(`nav a[href="${href}"]`)).toHaveLength(1);
    }
  });

  it("uses brand tokens on links and never the ledger gold", () => {
    const { container } = render(<AdminSidebar />);
    const link = container.querySelector('nav a[href="/admin/users"]');
    expect(link?.className).toContain("hover:text-primary");
    expect(container.innerHTML).not.toMatch(LEDGER_CLASS);
  });

  it("leaves no legacy gray or hex colors in the shell", () => {
    const { container } = render(<AdminSidebar />);
    expect(container.innerHTML).not.toMatch(/gray-\d|bg-white|#[0-9A-Fa-f]{6}/);
  });

  it("marks only the current route as active, in brand color", () => {
    nav.pathname = "/admin/users";
    const { container } = render(<AdminSidebar />);
    const active = container.querySelectorAll('nav a[aria-current="page"]');
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("href")).toBe("/admin/users");
    expect(active[0].className).toContain("text-primary");
    expect(container.innerHTML).not.toMatch(LEDGER_CLASS);
  });

  it("marks the most specific route active for a nested path", () => {
    nav.pathname = "/admin/campaigns/lifecycle/some-slug";
    const { container } = render(<AdminSidebar />);
    const active = container.querySelectorAll('nav a[aria-current="page"]');
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("href")).toBe("/admin/campaigns/lifecycle");
  });

  it("does not mark Dashboard active on other admin routes", () => {
    nav.pathname = "/admin/refunds/new";
    const { container } = render(<AdminSidebar />);
    expect(container.querySelector('nav a[href="/admin"]')?.getAttribute("aria-current")).toBeNull();
  });

  it("shows no numbers or counts in the nav labels (ticket criterion 3)", () => {
    nav.pathname = "/admin";
    const { container } = render(<AdminSidebar />);
    for (const a of container.querySelectorAll("nav a")) {
      expect(a.textContent).not.toMatch(/\d/);
    }
  });
});
