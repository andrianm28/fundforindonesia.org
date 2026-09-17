import { describe, test, expect, vi } from "vitest";
import * as fc from "fast-check";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import DesktopHeader from "@/components/layout/DesktopHeader";
import type { User } from "@/types";

// Feature: platform-polish, Property 9: Bell Navigation Consistency
// **Validates: Requirements 4.1**

// Mock next/link to render a plain anchor tag so we can inspect href
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) =>
    createElement("a", { href, ...props }, children),
}));

// Arbitrary for generating valid User objects
const userArb: fc.Arbitrary<User> = fc.record({
  id: fc.uuid(),
  email: fc.emailAddress(),
  name: fc.string({ minLength: 2, maxLength: 50 }),
  password: fc.option(fc.string({ minLength: 8 }), { nil: null }),
  avatar: fc.option(fc.webUrl(), { nil: null }),
  phone: fc.option(fc.string({ minLength: 10, maxLength: 15 }), { nil: null }),
  isVerified: fc.boolean(),
  verificationType: fc.option(fc.constantFrom("ktp" as const, "organization" as const), { nil: null }),
  donationBalance: fc.nat({ max: 100000000 }),
  createdAt: fc.date(),
  updatedAt: fc.date(),
});

// Arbitrary for notification count (non-negative integers)
const notificationCountArb = fc.nat({ max: 500 });

describe("Feature: platform-polish, Property 9: Bell Navigation Consistency", () => {
  test("Notification bell always has href='/inbox' for any authenticated user with any notification count", () => {
    fc.assert(
      fc.property(userArb, notificationCountArb, (user, notificationCount) => {
        const { container } = render(
          createElement(DesktopHeader, {
            user,
            notificationCount,
            onSearch: () => {},
          })
        );

        // Find the bell link by its aria-label
        const bellLink = container.querySelector('a[aria-label="Notifikasi"]');

        // The bell should always be rendered when user is provided
        expect(bellLink).not.toBeNull();

        // The bell link should always navigate to /inbox
        expect(bellLink!.getAttribute("href")).toBe("/inbox");

        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  test("Notification bell is never rendered when user is null", () => {
    const { container } = render(
      createElement(DesktopHeader, {
        user: null,
        notificationCount: 5,
        onSearch: () => {},
      })
    );

    const bellLink = container.querySelector('a[aria-label="Notifikasi"]');
    expect(bellLink).toBeNull();

    container.remove();
  });

  test("Bell href is '/inbox' regardless of notification count value", () => {
    fc.assert(
      fc.property(
        userArb,
        fc.oneof(
          fc.constant(0),
          fc.constant(1),
          fc.constant(99),
          fc.constant(100),
          fc.constant(999),
          fc.nat({ max: 10000 })
        ),
        (user, count) => {
          const { container } = render(
            createElement(DesktopHeader, {
              user,
              notificationCount: count,
              onSearch: () => {},
            })
          );

          const bellLink = container.querySelector('a[aria-label="Notifikasi"]');
          expect(bellLink).not.toBeNull();
          expect(bellLink!.getAttribute("href")).toBe("/inbox");

          container.remove();
        }
      ),
      { numRuns: 100 }
    );
  });
});
