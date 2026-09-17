import { describe, test, expect } from "vitest";
import * as fc from "fast-check";

// Feature: platform-polish, Property 1: Static Pages Accessibility
// **Validates: Requirements 1.9, 1.10**

// All 8 static pages with their expected heading text
// headingHtml is the HTML-encoded version that appears in renderToString output
const STATIC_PAGES = [
  { path: "/about", heading: "Tentang Kami", headingHtml: "Tentang Kami" },
  { path: "/careers", heading: "Karir", headingHtml: "Karir" },
  { path: "/press", heading: "Media", headingHtml: "Media" },
  { path: "/help", heading: "Help Center", headingHtml: "Help Center" },
  { path: "/faq", heading: "FAQ", headingHtml: "FAQ" },
  { path: "/contact", heading: "Kontak", headingHtml: "Kontak" },
  { path: "/terms", heading: "Syarat & Ketentuan", headingHtml: "Syarat &amp; Ketentuan" },
  { path: "/privacy", heading: "Kebijakan Privasi", headingHtml: "Kebijakan Privasi" },
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
          const { renderToString } = await import("react-dom/server");
          const { createElement } = await import("react");

          const html = renderToString(createElement(PageComponent));

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
          const { renderToString } = await import("react-dom/server");
          const { createElement } = await import("react");

          // If this throws, the page requires auth or has dependencies that fail without session
          const html = renderToString(createElement(PageComponent));
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

        const { renderToString } = await import("react-dom/server");
        const { createElement } = await import("react");

        const html = renderToString(createElement(PageComponent));

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
    case "/about":
      return import("@/app/(static)/about/page");
    case "/careers":
      return import("@/app/(static)/careers/page");
    case "/press":
      return import("@/app/(static)/press/page");
    case "/help":
      return import("@/app/(static)/help/page");
    case "/faq":
      return import("@/app/(static)/faq/page");
    case "/contact":
      return import("@/app/(static)/contact/page");
    case "/terms":
      return import("@/app/(static)/terms/page");
    case "/privacy":
      return import("@/app/(static)/privacy/page");
    default:
      throw new Error(`Unknown static page path: ${path}`);
  }
}

// Helper: escape special regex characters in a string
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
