# Ledger Line Campaign Detail Hero and Record Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the campaign detail page's desktop layout so a visitor sees the title and progress without scrolling past a full-bleed cover image, and render the confirmed/collected donation amount in the Record register's mono typeface so it reads as an attested number, not a marketing figure.

**Architecture:** The page's real markup lives in `src/components/campaign/CampaignDetailView.tsx` (a client component rendered by `src/app/campaign/[slug]/page.tsx`, which is a thin server-component data-fetching wrapper) -- this plan edits `CampaignDetailView.tsx`, not `page.tsx` itself, despite the ticket naming `page.tsx`. This component currently has ZERO responsive breakpoint classes anywhere (confirmed by grep before this plan was written) -- it is one single mobile-first column at every viewport width, so "fix the below-the-fold hero problem" is really "add a desktop-specific side-by-side layout that doesn't exist yet," not a repair of a broken existing one. The donate button is already a `position: fixed` bottom bar, which is already visible on every viewport width regardless of scroll position -- this plan does not duplicate it for desktop (see Task 1's Design decision); it only needs to move the title/amount/progress out from under the tall stacked image into a layout that sits beside the (now aspect-ratio-capped) hero image at the `lg` breakpoint (1025px+, this codebase's own documented desktop threshold). A second, independent, smaller task applies `font-mono` to exactly one element: the confirmed/collected amount.

**Tech Stack:** Next.js 14, Tailwind CSS, React, Vitest.

**Spec:** .scratch/ledger-line-visual-refresh/issues/03-campaign-detail-hero-and-record-register.md (ticket; parent spec .scratch/ledger-line-visual-refresh/spec.md)

**Gerbang specflow:** rencana ini BELUM siap dieksekusi sampai kedua perintah
di bawah keluar dengan status 0.

    /home/ubuntu/.claude/skills/specflow/scripts/check-plan-headings.sh    docs/superpowers/plans/2026-09-24-ledger-line-campaign-detail.md /home/ubuntu/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief
    /home/ubuntu/.claude/skills/specflow/scripts/check-seam-constraints.sh docs/superpowers/plans/2026-09-24-ledger-line-campaign-detail.md /home/ubuntu/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/task-brief

## Global Constraints

- The hero image is capped to a fixed aspect ratio (this plan uses 21:9, the ticket's own named example) at the `lg` breakpoint (1025px+); the info panel (title/progress) sits adjacent to it on wide viewports instead of stacked beneath it, so title and progress are visible without scrolling on a typical desktop viewport.
- The narrow-viewport (mobile) layout must not regress -- verify it separately from the desktop fix.
- The confirmed/collected donation amount uses the Record register's mono typeface (`font-mono` / `var(--font-jetbrains-mono)`, already wired by ticket 01).
- No other content on the page switches to the Record register -- a donate button, form field, or any interactive control stays in the everyday sans register; only the one stated-fact number changes.
- No visual-regression testing tool is introduced -- manual browser verification is the stated seam for the visual appearance itself.
- Existing behavioral test coverage must stay exactly as rigorous as today -- only additions, no weakened or removed assertions.
- No change to routes, data model, or business logic -- this is a pure visual/CSS/markup change.

---

### Task 1: Responsive hero + quick-info-panel layout

**Files:**
- Modify: `src/components/campaign/CampaignDetailView.tsx`
- Test: `src/components/campaign/CampaignDetailView.test.tsx`

**Interfaces:**
- Produces: three new `data-testid` markers on the JSX tree -- `campaign-hero-section` (the wrapper around the hero image and quick info panel), `campaign-hero-image` (the image container), `campaign-quick-info` (the info panel container). Task 2 consumes `campaign-quick-info`'s existing child structure -- specifically, the confirmed/collected amount `<p>` this task places inside it -- to locate its edit target.
- Consumes: nothing from another task (this is Task 1).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `src/components/campaign/CampaignDetailView.test.tsx` (existing component test suite -- the parent spec's Testing Decisions section names this class of test as the seam for this whole ticket set: a visual/CSS/markup change with no new business logic, existing component tests are the seam, behavioral rigor must not weaken, no snapshot/visual-regression tooling). Cakup SETIAP perilaku task ini MELALUI seam itu: the wrapper's responsive class intent (mobile stays block-stacked by default, `lg:flex`/`lg:flex-row` only applies from 1025px), the hero image's aspect-ratio/height-cap classes co-existing for both mobile and desktop, the quick info panel's width class, that creator info/tabs/story still render below the hero section, and that the fixed donate CTA remains a single element with no desktop-only duplicate. Nilai harapan dalam test adalah literal yang diketahui (`'lg:flex'`, `'lg:w-2/5'`, `'aspect-video'`, dll.), bukan dihitung ulang dari kode. jsdom does not evaluate real CSS layout or media queries -- these tests verify the correct Tailwind classes are wired (developer intent), not actual rendered pixels; the ticket's own manual-browser-verification requirement (Step 5 below) is what proves the real visual result, and is not a substitute for the automated tests, nor are the automated tests a substitute for it.

**Facts gathered (do not re-derive):**

Current `CampaignDetailView.tsx` has ZERO responsive breakpoint classes anywhere (grep-confirmed: no `sm:`/`md:`/`lg:`/`xl:`/`2xl:` prefix exists in this file today) -- it is a single mobile-first column at every viewport width. `tailwind.config.ts`'s `lg` breakpoint is `1025px` (already documented in that file's own comment: "Desktop (requirement 10.3: 1025px+)") -- this is the desktop threshold to use, not a new one to invent.

The donate CTA (`<Link href={`/campaign/${campaign.slug}/donate`}>Donasi sekarang</Link>`) is already inside a `fixed bottom-0 left-0 right-0` bar -- `position: fixed` means it is already visible on every viewport width regardless of scroll position, TODAY, before this task changes anything. **Design decision, recorded so the reviewer doesn't flag it as an unaddressed acceptance criterion:** this task does NOT add a second, desktop-only donate button inside the new side-by-side info panel. The ticket names "title/progress/donate-button" together as things that must be visible without scrolling on desktop, but the donate button already satisfies that today via its fixed positioning, independent of any layout change here -- duplicating it would require either rendering two `<Link>`s with identical text (breaking the existing test `screen.getByText('Donasi sekarang')`, which requires exactly one match) or a more complex CSS-only relocation trick for no real user-facing benefit. Only title and progress -- the two elements that genuinely were stacked below a tall image -- move into the new adjacent-on-desktop layout.

Current relevant section of `CampaignDetailView.tsx` (lines 113-181, the block this task restructures) -- the full return statement around it, for placement context:
```tsx
  return (
    <div className="min-h-screen bg-white pb-20">
      {/* Back button header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-text hover:text-primary transition-colors"
            aria-label="Kembali"
          >
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <h1 className="text-sm font-medium text-text truncate flex-1">
            {campaign.title}
          </h1>
          {/* Share button placeholder */}
          <button
            className="text-text hover:text-primary transition-colors"
            aria-label="Bagikan"
          >
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
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Cover Image - full width */}
      <div className="relative w-full aspect-video max-h-[300px] overflow-hidden">
        <Image
          src={campaign.coverImage}
          alt={campaign.title}
          fill
          className="object-cover"
          priority
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 768px, 1024px"
        />
        {campaign.isUrgent && (
          <span className="absolute top-3 left-3 bg-danger text-white text-xs font-semibold px-2.5 py-1 rounded">
            DARURAT
          </span>
        )}
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Demo campaign badge (task M9) -- plain Indonesian, above the
            title, so it is seen before "Donasi sekarang" at the bottom is
            ever tapped, not discovered after the donation is refused. */}
        {campaign.isDemo && (
          <span className="inline-block bg-gray-800/90 text-white text-xs font-semibold px-2.5 py-1 rounded mb-2">
            Kampanye contoh — tidak menerima donasi sungguhan
          </span>
        )}

        {/* Title */}
        <h2 className="text-lg font-bold text-text leading-tight mb-3">
          {campaign.title}
        </h2>

        {/* Amount collected */}
        <div className="space-y-2 mb-4">
          <p className="text-xl font-bold text-primary">
            {formatRupiah(campaign.collectedAmount)}
          </p>

          {/* Progress bar */}
          <ProgressBar
            current={campaign.collectedAmount}
            target={campaign.targetAmount}
            size="md"
            animated
          />

          {/* Stats row */}
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>
              terkumpul dari{' '}
              <span className="font-medium text-text">
                {formatRupiah(campaign.targetAmount)}
              </span>
            </span>
            {remainingDays !== null && remainingDays > 0 && (
              <span className="font-medium">{remainingDays} hari lagi</span>
            )}
            {remainingDays !== null && remainingDays === 0 && (
              <span className="font-medium text-danger">Berakhir</span>
            )}
          </div>

          {/* Donation count */}
          <p className="text-xs text-text-secondary">
            <span className="font-semibold text-text">{campaign.donationCount.toLocaleString('id-ID')}</span>{' '}
            donatur
          </p>
        </div>

        {/* Creator info */}
        <div className="flex items-center gap-3 py-3 border-t border-b border-border mb-4">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
            {campaign.creator.avatar ? (
              <Image
                src={campaign.creator.avatar}
                alt={campaign.creator.name}
                width={40}
                height={40}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-secondary text-sm font-semibold">
                {campaign.creator.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Creator details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium text-text truncate">
                {campaign.creator.name}
              </span>
              {campaign.creator.isVerified && (
                <VerificationBadge
                  verificationType={campaign.creator.verificationType}
                  size="sm"
                />
              )}
            </div>
            {campaign.creator.isVerified && (
              <p className="text-xs text-text-secondary">
                Identitas terverifikasi
              </p>
            )}
          </div>
        </div>

        {/* Tab navigation placeholder - will be replaced in task 14.2 */}
        <div className="flex gap-4 border-b border-border mb-4">
          <button className="pb-2 text-sm font-medium text-primary border-b-2 border-primary">
            Cerita
          </button>
          <button className="pb-2 text-sm font-medium text-text-secondary hover:text-text transition-colors">
            Kabar Terbaru
          </button>
          <button className="pb-2 text-sm font-medium text-text-secondary hover:text-text transition-colors">
            Pencairan Dana
          </button>
        </div>

        {/* Campaign Story */}
        <div
          className="prose prose-sm max-w-none text-text leading-relaxed
            prose-headings:text-text prose-headings:font-semibold
            prose-p:text-text prose-p:leading-relaxed
            prose-img:rounded-lg prose-img:my-4
            prose-a:text-primary prose-a:no-underline hover:prose-a:underline"
          dangerouslySetInnerHTML={{ __html: campaign.story }}
        />
      </div>

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border p-4 z-10">
        <div className="max-w-3xl mx-auto">
          <Link
            href={`/campaign/${campaign.slug}/donate`}
            className="block w-full py-3 rounded-lg font-semibold text-base text-center bg-primary text-white hover:bg-primary-dark transition-colors"
          >
            Donasi sekarang
          </Link>
        </div>
      </div>
    </div>
  );
```

Existing `CampaignDetailView.test.tsx` (full file, 63 lines) -- read in full. 3 tests: demo badge absent for regular campaign, demo badge present+visible for demo campaign, `'Donasi sekarang'` CTA still renders for a demo campaign. None touch layout classes or responsive behavior. `mockCampaign` fixture: `collectedAmount: 25841000`, `targetAmount: 50000000`, `donationCount: 12`, `creator.name: 'Yayasan Peduli Bencana'`. `formatRupiah(25841000)` → `'Rp25.841.000'`, `formatRupiah(50000000)` → `'Rp50.000.000'` (confirmed by reading `src/lib/utils/currency.ts`).

- [ ] **Step 1: Write the failing tests for the responsive hero/info-panel layout**

Add to `src/components/campaign/CampaignDetailView.test.tsx`, inside the existing `describe('CampaignDetailView', ...)` block (do not remove or alter any existing `it(...)`):

```tsx
  it('wraps the hero image and quick info panel in a container that stacks by default and goes side-by-side from the lg breakpoint (1025px)', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const wrapper = container.querySelector('[data-testid="campaign-hero-section"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toContain('lg:flex');
    expect(wrapper.className).toContain('lg:flex-row');
  });

  it('caps the hero image to a 21:9 aspect ratio from lg, while keeping the existing mobile aspect ratio and height cap', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const imageBox = container.querySelector('[data-testid="campaign-hero-image"]') as HTMLElement;
    expect(imageBox).not.toBeNull();
    expect(imageBox.className).toContain('aspect-video');
    expect(imageBox.className).toContain('max-h-[300px]');
    expect(imageBox.className).toContain('lg:aspect-[21/9]');
    expect(imageBox.className).toContain('lg:max-h-none');
  });

  it('sizes the quick info panel to 2/5 width from the lg breakpoint', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const infoPanel = container.querySelector('[data-testid="campaign-quick-info"]') as HTMLElement;
    expect(infoPanel).not.toBeNull();
    expect(infoPanel.className).toContain('lg:w-2/5');
  });

  it('still renders creator info, tab labels, and the campaign story below the hero section', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.getByText(mockCampaign.creator.name)).toBeDefined();
    expect(screen.getByText('Cerita')).toBeDefined();
    expect(screen.getByText('Kabar Terbaru')).toBeDefined();
    expect(screen.getByText('Pencairan Dana')).toBeDefined();
  });

  it('keeps a single fixed-position donate CTA visible on every viewport, with no separate desktop-only duplicate', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    const ctaLinks = screen.getAllByText('Donasi sekarang');
    expect(ctaLinks).toHaveLength(1);
    const fixedBar = ctaLinks[0].closest('.fixed') as HTMLElement;
    expect(fixedBar).not.toBeNull();
    expect(fixedBar.className).not.toContain('lg:hidden');
  });
```

This file's top imports `{ render, screen, cleanup }` from `@testing-library/react` already -- both `render` and `screen` are already available, no new import needed.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/components/campaign/CampaignDetailView.test.tsx`
Expected: the first 3 new tests FAIL (no `data-testid="campaign-hero-section"`/`"campaign-hero-image"`/`"campaign-quick-info"` exist yet, no `lg:` classes exist anywhere in the file yet). The last 2 new tests PASS already (creator/tabs/story already render today; there's already exactly one `'Donasi sekarang'` CTA today) -- that's expected; they become real regression guards once Step 3 restructures the file. All 3 pre-existing tests still PASS.

- [ ] **Step 3: Restructure `CampaignDetailView.tsx`'s hero/content section**

Replace the `return (...)` statement's body -- from `<div className="min-h-screen bg-white pb-20">` through its closing `</div>` -- with:

```tsx
    <div className="min-h-screen bg-white pb-20">
      {/* Back button header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-text hover:text-primary transition-colors"
            aria-label="Kembali"
          >
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <h1 className="text-sm font-medium text-text truncate flex-1">
            {campaign.title}
          </h1>
          {/* Share button placeholder */}
          <button
            className="text-text hover:text-primary transition-colors"
            aria-label="Bagikan"
          >
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
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Hero image + quick info panel -- stacked by default, side-by-side
          from lg (1025px) up. The donate CTA is NOT duplicated here: it is
          already a `fixed` bottom bar, already visible on every viewport
          regardless of scroll, below. */}
      <div
        data-testid="campaign-hero-section"
        className="lg:flex lg:flex-row lg:gap-8 lg:items-start lg:max-w-5xl lg:mx-auto lg:px-4 lg:pt-6"
      >
        {/* Cover Image */}
        <div
          data-testid="campaign-hero-image"
          className="relative w-full aspect-video max-h-[300px] overflow-hidden lg:w-3/5 lg:flex-shrink-0 lg:max-h-none lg:aspect-[21/9] lg:rounded-lg"
        >
          <Image
            src={campaign.coverImage}
            alt={campaign.title}
            fill
            className="object-cover"
            priority
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 768px, 1024px"
          />
          {campaign.isUrgent && (
            <span className="absolute top-3 left-3 bg-danger text-white text-xs font-semibold px-2.5 py-1 rounded">
              DARURAT
            </span>
          )}
        </div>

        {/* Quick info panel: demo badge, title, amount, progress, stats, donation count */}
        <div
          data-testid="campaign-quick-info"
          className="px-4 py-4 lg:px-0 lg:py-0 lg:w-2/5 lg:flex-shrink-0"
        >
          {/* Demo campaign badge (task M9) -- plain Indonesian, above the
              title, so it is seen before "Donasi sekarang" at the bottom is
              ever tapped, not discovered after the donation is refused. */}
          {campaign.isDemo && (
            <span className="inline-block bg-gray-800/90 text-white text-xs font-semibold px-2.5 py-1 rounded mb-2">
              Kampanye contoh — tidak menerima donasi sungguhan
            </span>
          )}

          {/* Title */}
          <h2 className="text-lg font-bold text-text leading-tight mb-3">
            {campaign.title}
          </h2>

          {/* Amount collected */}
          <div className="space-y-2 mb-4">
            <p className="text-xl font-bold text-primary">
              {formatRupiah(campaign.collectedAmount)}
            </p>

            {/* Progress bar */}
            <ProgressBar
              current={campaign.collectedAmount}
              target={campaign.targetAmount}
              size="md"
              animated
            />

            {/* Stats row */}
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span>
                terkumpul dari{' '}
                <span className="font-medium text-text">
                  {formatRupiah(campaign.targetAmount)}
                </span>
              </span>
              {remainingDays !== null && remainingDays > 0 && (
                <span className="font-medium">{remainingDays} hari lagi</span>
              )}
              {remainingDays !== null && remainingDays === 0 && (
                <span className="font-medium text-danger">Berakhir</span>
              )}
            </div>

            {/* Donation count */}
            <p className="text-xs text-text-secondary">
              <span className="font-semibold text-text">{campaign.donationCount.toLocaleString('id-ID')}</span>{' '}
              donatur
            </p>
          </div>
        </div>
      </div>

      {/* Creator info, tabs, and campaign story -- full width, below the
          hero section on every viewport */}
      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Creator info */}
        <div className="flex items-center gap-3 py-3 border-t border-b border-border mb-4">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
            {campaign.creator.avatar ? (
              <Image
                src={campaign.creator.avatar}
                alt={campaign.creator.name}
                width={40}
                height={40}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-secondary text-sm font-semibold">
                {campaign.creator.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Creator details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium text-text truncate">
                {campaign.creator.name}
              </span>
              {campaign.creator.isVerified && (
                <VerificationBadge
                  verificationType={campaign.creator.verificationType}
                  size="sm"
                />
              )}
            </div>
            {campaign.creator.isVerified && (
              <p className="text-xs text-text-secondary">
                Identitas terverifikasi
              </p>
            )}
          </div>
        </div>

        {/* Tab navigation placeholder - will be replaced in task 14.2 */}
        <div className="flex gap-4 border-b border-border mb-4">
          <button className="pb-2 text-sm font-medium text-primary border-b-2 border-primary">
            Cerita
          </button>
          <button className="pb-2 text-sm font-medium text-text-secondary hover:text-text transition-colors">
            Kabar Terbaru
          </button>
          <button className="pb-2 text-sm font-medium text-text-secondary hover:text-text transition-colors">
            Pencairan Dana
          </button>
        </div>

        {/* Campaign Story */}
        <div
          className="prose prose-sm max-w-none text-text leading-relaxed
            prose-headings:text-text prose-headings:font-semibold
            prose-p:text-text prose-p:leading-relaxed
            prose-img:rounded-lg prose-img:my-4
            prose-a:text-primary prose-a:no-underline hover:prose-a:underline"
          dangerouslySetInnerHTML={{ __html: campaign.story }}
        />
      </div>

      {/* Fixed bottom CTA -- already visible on every viewport regardless of
          scroll position (position: fixed), so this alone already satisfies
          "donate button visible without scrolling" on desktop too; no
          separate desktop-specific button is added (see this task's Design
          decision above). */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border p-4 z-10">
        <div className="max-w-3xl mx-auto">
          <Link
            href={`/campaign/${campaign.slug}/donate`}
            className="block w-full py-3 rounded-lg font-semibold text-base text-center bg-primary text-white hover:bg-primary-dark transition-colors"
          >
            Donasi sekarang
          </Link>
        </div>
      </div>
    </div>
```

No changes to any `import` line, the component's props/types, or anything before the `return` statement.

- [ ] **Step 4: Run `CampaignDetailView.test.tsx` to verify all tests pass**

Run: `npx vitest run src/components/campaign/CampaignDetailView.test.tsx`
Expected: all 8 tests PASS -- the 3 pre-existing tests unmodified, and the 5 new tests.

- [ ] **Step 5: Manual browser verification (mobile and desktop)**

Start the dev server (`npm run dev`) and visit a real campaign detail page (`/campaign/<slug>` for a seeded campaign). Confirm:
- At a desktop viewport width (1025px+): the hero image is capped to a 21:9-ish band and sits beside the title/amount/progress panel, not stacked above it -- title and progress are visible without scrolling.
- At a mobile viewport width (under 1025px): the layout is pixel-for-pixel the same as before this task -- image full-width on top, capped at 300px tall, everything else stacked below it, fixed donate bar at the bottom. Confirm nothing regressed.
- A campaign with a long story/description and a tall cover image no longer pushes the title/progress out of view on desktop.

If the dev environment has no seeded campaigns or another blocker prevents visiting a real detail page, read the compiled/rendered output via the component test suite's DOM output as a documented substitute (this can show the correct classes are wired, but not real paint/layout -- say so explicitly), and note the blocker in the task report -- do not silently skip this verification.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all test files PASS, including this task's changes and every other suite in the repo (this task touches no other file).

- [ ] **Step 7: Commit**

```bash
git add src/components/campaign/CampaignDetailView.tsx src/components/campaign/CampaignDetailView.test.tsx
git commit -m "feat: side-by-side hero and info panel on the campaign detail page at desktop widths"
```

---

### Task 2: Record register mono typeface for the confirmed amount

**Files:**
- Modify: `src/components/campaign/CampaignDetailView.tsx`
- Test: `src/components/campaign/CampaignDetailView.test.tsx`

**Interfaces:**
- Consumes: Task 1's restructured file -- specifically, the confirmed/collected amount `<p className="text-xl font-bold text-primary">{formatRupiah(campaign.collectedAmount)}</p>` now living inside the `data-testid="campaign-quick-info"` panel Task 1 created. This task edits only that one `<p>`'s `className`.
- Produces: nothing another task consumes (this is the last task in this plan).

**Seam constraint (MENGIKAT task ini, dari spec):** Seam yang diuji untuk task ini adalah `src/components/campaign/CampaignDetailView.test.tsx` (same seam as Task 1 -- an existing component test suite, per the parent spec's Testing Decisions section). Cakup SETIAP perilaku task ini MELALUI seam itu: the confirmed/collected amount carries the mono typeface, and -- just as important -- every other piece of text on the page (target amount, title, donate CTA, tab labels, creator name) does NOT. Nilai harapan literal: `'font-mono'`, exact known formatted-amount strings (`'Rp25.841.000'`, `'Rp50.000.000'`), not recalculated from `formatRupiah` in the test.

**Facts gathered (do not re-derive):**

After Task 1, the exact block to change is:
```tsx
            <p className="text-xl font-bold text-primary">
              {formatRupiah(campaign.collectedAmount)}
            </p>
```
inside the `data-testid="campaign-quick-info"` div, the first child of its `<div className="space-y-2 mb-4">`.

`tailwind.config.ts`'s `fontFamily.mono` is already wired to `var(--font-jetbrains-mono)` by ticket 01 -- no font-loading or config change is needed here, only applying the existing `font-mono` utility class to this one element.

`mockCampaign.collectedAmount = 25841000` → `formatRupiah` → `'Rp25.841.000'`. `mockCampaign.targetAmount = 50000000` → `'Rp50.000.000'` (both confirmed by reading `src/lib/utils/currency.ts`'s implementation, not assumed).

- [ ] **Step 1: Write the failing tests for the mono typeface**

Add to `src/components/campaign/CampaignDetailView.test.tsx`, inside the existing `describe('CampaignDetailView', ...)` block:

```tsx
  it('renders the confirmed/collected amount in the Record register mono typeface', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    const amount = screen.getByText('Rp25.841.000');
    expect(amount.className).toContain('font-mono');
  });

  it('does not apply the mono typeface to the target amount, title, or donate CTA', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    const targetAmount = screen.getByText('Rp50.000.000');
    expect(targetAmount.className).not.toContain('font-mono');
    const title = screen.getByText(mockCampaign.title);
    expect(title.className).not.toContain('font-mono');
    const donateCta = screen.getByText('Donasi sekarang');
    expect(donateCta.className).not.toContain('font-mono');
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/components/campaign/CampaignDetailView.test.tsx`
Expected: the first new test FAILS (`font-mono` isn't applied yet). The second new test PASSES already (nothing has the mono class yet, so the negative assertions trivially hold) -- expected, it becomes a real regression guard once Step 3 lands. All other tests still PASS.

- [ ] **Step 3: Apply `font-mono` to the confirmed/collected amount**

In `src/components/campaign/CampaignDetailView.tsx`, change:

```tsx
            <p className="text-xl font-bold text-primary">
              {formatRupiah(campaign.collectedAmount)}
            </p>
```

to:

```tsx
            <p className="text-xl font-bold text-primary font-mono">
              {formatRupiah(campaign.collectedAmount)}
            </p>
```

No other line changes.

- [ ] **Step 4: Run `CampaignDetailView.test.tsx` to verify all tests pass**

Run: `npx vitest run src/components/campaign/CampaignDetailView.test.tsx`
Expected: all 10 tests PASS -- the 8 from Task 1 unmodified, and the 2 new tests.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all test files PASS.

- [ ] **Step 6: Manual browser verification**

On the same real campaign detail page used in Task 1's Step 5, confirm the confirmed/collected amount visibly renders in the monospace Record register typeface (JetBrains Mono), distinct from the rest of the page's sans-serif text, and that no other element on the page (title, donate button, tab labels, target-amount text) changed typeface.

- [ ] **Step 7: Commit**

```bash
git add src/components/campaign/CampaignDetailView.tsx src/components/campaign/CampaignDetailView.test.tsx
git commit -m "feat: render the confirmed donation amount in the Record register mono typeface"
```
