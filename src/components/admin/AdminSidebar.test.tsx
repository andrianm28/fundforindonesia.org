import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));

import { AdminSidebar } from "./AdminSidebar";

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
    expect(container.innerHTML).not.toContain("ledger");
  });
});
