import { describe, test, expect } from "vitest";
import * as fc from "fast-check";
import { vi } from "vitest";

// The About, Press, Careers and Contact pages read their text from the
// settings table; with nothing stored they show the defaults.
vi.mock("@/lib/prisma", () => ({ prisma: { siteSetting: { findMany: async () => [] } } }));


// Feature: platform-polish, Property 1: Static Pages Accessibility
// **Validates: Requirements 1.9, 1.10**

// All 8 static pages with their expected heading text
// headingHtml is the HTML-encoded version that appears in renderToString output
const STATIC_PAGES = [
  { path: "/tentang-kami", heading: "Tentang Kami", headingHtml: "Tentang Kami" },
  { path: "/karir", heading: "Karir", headingHtml: "Karir" },
  { path: "/media", heading: "Media", headingHtml: "Media" },
  { path: "/bantuan", heading: "Help Center", headingHtml: "Help Center" },
  { path: "/faq", heading: "FAQ", headingHtml: "FAQ" },
  { path: "/kontak", heading: "Kontak", headingHtml: "Kontak" },
  { path: "/syarat-dan-ketentuan", heading: "Syarat & Ketentuan", headingHtml: "Syarat &amp; Ketentuan" },
  { path: "/kebijakan-privasi", heading: "Kebijakan Privasi", headingHtml: "Kebijakan Privasi" },
] as const;

// Arbitrary that picks any of the 8 static pages
const staticPageArb = fc.constantFrom(...STATIC_PAGES);

describe("Feature: platform-polish, Property 1: Static Pages Accessibility", () => {
  describe("All static pages render correct heading without authentication", () => {
    test("Any static page renders its expected heading as an h1 element", async () => {
      await fc.assert(
        fc.asyncProperty(staticPageArb, async (page) => {
          // Dynamically import the page component based on the path
          const pageModule = await importPageModule(page.path);
          const PageComponent = pageModule.default;

          // Render the page component and verify heading text exists
          const html = await renderPage(PageComponent);

          // Verify the page renders (non-empty response = HTTP 200 equivalent for SSR)
          expect(html.length).toBeGreaterThan(0);

          // Verify the heading text is present in the rendered output (HTML-encoded)
          expect(html).toContain(page.headingHtml);

          // Verify it's wrapped in an h1 tag
          expect(html).toMatch(new RegExp(`<h1[^>]*>[^<]*${escapeRegExp(page.headingHtml)}`, "s"));
        }),
        { numRuns: 50 }
      );
    });

    test("No static page requires authentication (all export default functions without auth guards)", async () => {
      await fc.assert(
        fc.asyncProperty(staticPageArb, async (page) => {
          const pageModule = await importPageModule(page.path);
          const PageComponent = pageModule.default;

          // The page component should be a simple function (no auth middleware wrapping)
          expect(typeof PageComponent).toBe("function");

          // Render without any session context — should succeed without errors
          // If this throws, the page requires auth or has dependencies that fail without session
          const html = await renderPage(PageComponent);
          expect(html).toContain(page.headingHtml);
        }),
        { numRuns: 50 }
      );
    });

    test("All static pages export SEO metadata with title and description", async () => {
      await fc.assert(
        fc.asyncProperty(staticPageArb, async (page) => {
          const pageModule = await importPageModule(page.path);

          // Each page should export a metadata object with title and description
          expect(pageModule.metadata).toBeDefined();
          expect(typeof pageModule.metadata.title).toBe("string");
          expect((pageModule.metadata.title as string).length).toBeGreaterThan(0);
          expect(typeof pageModule.metadata.description).toBe("string");
          expect((pageModule.metadata.description as string).length).toBeGreaterThan(0);
        }),
        { numRuns: 50 }
      );
    });
  });

  describe("Exhaustive check: every static page individually accessible", () => {
    for (const page of STATIC_PAGES) {
      test(`${page.path} renders heading "${page.heading}" and is publicly accessible`, async () => {
        const pageModule = await importPageModule(page.path);
        const PageComponent = pageModule.default;

        const html = await renderPage(PageComponent);

        // HTTP 200 equivalent: page renders successfully
        expect(html.length).toBeGreaterThan(0);

        // Correct heading is rendered (using HTML-encoded version)
        expect(html).toContain(page.headingHtml);

        // Metadata exists (SEO requirement)
        expect(pageModule.metadata).toBeDefined();
        expect(pageModule.metadata.title).toBeDefined();
        expect(pageModule.metadata.description).toBeDefined();
      });
    }
  });
});

// Helper: dynamically import the page module based on path
async function importPageModule(path: string): Promise<any> {
  switch (path) {
    case "/tentang-kami":
      return import("@/app/(static)/tentang-kami/page");
    case "/karir":
      return import("@/app/(static)/karir/page");
    case "/media":
      return import("@/app/(static)/media/page");
    case "/bantuan":
      return import("@/app/(static)/bantuan/page");
    case "/faq":
      return import("@/app/(static)/faq/page");
    case "/kontak":
      return import("@/app/(static)/kontak/page");
    case "/syarat-dan-ketentuan":
      return import("@/app/(static)/syarat-dan-ketentuan/page");
    case "/kebijakan-privasi":
      return import("@/app/(static)/kebijakan-privasi/page");
    default:
      throw new Error(`Unknown static page path: ${path}`);
  }
}

// Helper: escape special regex characters in a string
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Helper: a page is a server component, sync or async; render what it returns.
async function renderPage(PageComponent: () => unknown): Promise<string> {
  const { renderToString } = await import("react-dom/server");
  return renderToString((await PageComponent()) as React.ReactElement);
}
