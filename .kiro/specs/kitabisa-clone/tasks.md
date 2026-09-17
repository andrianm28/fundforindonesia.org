# Implementation Plan: Kitabisa Clone

## Overview

This implementation plan covers the full-featured Kitabisa.com clone — a modern Indonesian crowdfunding/donation platform built with Next.js 14, TypeScript, Tailwind CSS, Prisma/PostgreSQL, and real-time features via SSE. The plan is organized for sequential implementation with incremental validation, covering project setup, UI components, APIs, real-time features, animations, SEO, error handling, caching, and comprehensive testing.

## Tasks

- [x] 1. Project Setup and Core Infrastructure
  - [x] 1.1 Initialize Next.js 14 project with TypeScript, App Router, and Tailwind CSS
    - Run `npx create-next-app@14` with TypeScript and App Router options
    - Configure `tailwind.config.ts` with custom design tokens (colors, fonts, radii, shadows, transitions matching kitabisa.com)
    - Create `src/styles/globals.css` with CSS custom properties for design tokens
    - Install core dependencies: `prisma`, `@prisma/client`, `next-auth`, `zustand`, `swr`, `framer-motion`, `zod`
    - _Requirements: 10.6, 10.7_

  - [x] 1.2 Set up project folder structure and TypeScript type definitions
    - Create directory structure: `app/`, `components/ui/`, `components/campaign/`, `components/donation/`, `components/home/`, `components/layout/`, `components/shared/`, `lib/`, `lib/utils/`, `lib/hooks/`, `store/`, `types/`
    - Create TypeScript type definitions: `types/campaign.ts`, `types/donation.ts`, `types/user.ts`, `types/notification.ts`
    - Define all entity interfaces matching Prisma models
    - _Requirements: 10.1, 10.2, 10.3_


  - [x] 1.3 Configure Prisma ORM with PostgreSQL and create database schema
    - Install Prisma and initialize with PostgreSQL provider
    - Create full Prisma schema with all models: User, Account, Campaign, Donation, Prayer, CampaignUpdate, Disbursement, Notification, AutoDonation, Category
    - Define all relations, constraints, indexes, and cascade rules
    - Run `prisma migrate dev` and generate Prisma client
    - Create `lib/prisma.ts` singleton instance
    - _Requirements: 4.3, 6.5, 9.1_

  - [x] 1.4 Configure NextAuth.js with email/password and Google OAuth
    - Install `next-auth`, `bcryptjs`, `@auth/prisma-adapter`
    - Create `app/api/auth/[...nextauth]/route.ts` with credentials and Google providers
    - Create `lib/auth.ts` with session helpers and auth middleware
    - Configure Prisma adapter for OAuth accounts
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 1.5 Create utility functions for currency, date, and validation
    - Create `lib/utils/currency.ts` with `formatRupiah()` and `parseRupiah()` functions
    - Create `lib/utils/date.ts` with Indonesian date formatting and relative timestamps
    - Create `lib/utils/validation.ts` with donation amount, email, and form field validators
    - Create `lib/utils/zakat.ts` with Zakat calculation logic (2.5% of assets above nisab)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 15.3_

  - [x] 1.6 Set up testing infrastructure (Vitest, fast-check, React Testing Library, Playwright)
    - Install `vitest`, `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`
    - Install `fast-check` for property-based testing
    - Install `playwright` and `@playwright/test` for E2E tests
    - Create `vitest.config.ts` with React plugin, jsdom environment, and path aliases
    - Create `playwright.config.ts` with mobile/tablet/desktop viewport projects
    - Create test setup file `tests/setup.ts` with Testing Library matchers
    - Create test database configuration for integration tests
    - _Requirements: All (testing infrastructure)_

- [x] 2. Checkpoint - Verify project builds and tests run
  - Ensure `npm run build` succeeds, `npx vitest --run` executes, and Prisma client is generated. Ask the user if questions arise.

- [x] 3. Base UI Components with Skeleton Loading States
  - [x] 3.1 Create Button component with all variants and loading state
    - Implement `ButtonProps` interface: variant (primary/secondary/ghost/danger), size (sm/md/lg/full), isLoading, disabled, icons
    - Add press scale micro-interaction (0.97 scale on active)
    - Style with Tailwind matching kitabisa.com button styles
    - _Requirements: 4.12, 6.1_

  - [x] 3.2 Create ProgressBar component with animated fill
    - Implement `ProgressBarProps` interface: current, target, showLabel, size, animated
    - Calculate percentage: `Math.min((current / target) * 100, 100)` — never exceeds 100%, never negative
    - Add 600ms ease-in-out fill animation on mount when `animated=true`
    - Style with kitabisa orange-to-red gradient fill on gray background
    - _Requirements: 3.4, 4.4_

  - [x] 3.3 Create Skeleton component with shimmer animation
    - Implement `SkeletonProps` interface: variant (text/circular/rectangular/card), width, height, lines, animated
    - Create CSS `@keyframes` shimmer animation (left-to-right gradient sweep at 1.5s interval)
    - Support composable skeleton layouts for all page loading states
    - _Requirements: 10.1 (loading UX)_

  - [x] 3.4 Create LazyImage component with blur placeholder and fallback
    - Implement `LazyImageProps` interface: src, alt, width, height, blurDataURL, priority, fallback
    - Wrap Next.js Image with skeleton placeholder until loaded
    - Show gray placeholder with category icon if image fails to load
    - Support `priority={true}` for above-fold images (skip lazy loading)
    - Add 200ms opacity fade-in transition on load
    - _Requirements: 3.1, 4.1_

  - [x] 3.5 Create Input component with validation UX and error states
    - Implement `InputProps` interface: type, label, placeholder, value, onChange, error, helperText, prefix, disabled, required
    - Add real-time validation on blur, red border + error message display
    - Support "Rp" prefix for currency inputs
    - Add field shake animation on invalid submit
    - _Requirements: 6.3, 6.8, 11.2_

  - [x] 3.6 Create Modal component with overlay and size variants
    - Implement `ModalProps` interface: isOpen, onClose, title, size (sm/md/lg/fullscreen), closeOnOverlayClick, showCloseButton
    - Add Framer Motion enter/exit animations (fade + scale)
    - Support focus trap and escape key close
    - _Requirements: 18.3_

  - [x] 3.7 Write unit tests for ProgressBar percentage calculation
    - Test edge cases: 0/100, 100/100, 150/100 (capped at 100%), 0/0
    - Verify animated prop triggers animation class
    - _Requirements: 3.4, 4.4_

- [x] 4. Property-Based Tests for Utility Functions
  - [x] 4.1 Write property test for Progress Bar Accuracy (Property 2)
    - **Property 2: Progress Bar Accuracy**
    - Generate random (collectedAmount, targetAmount) pairs where targetAmount > 0
    - Verify percentage equals `Math.min((collectedAmount / targetAmount) * 100, 100)`, never exceeds 100%, never negative
    - **Validates: Requirements 3.4, 4.4**

  - [x] 4.2 Write property test for Currency Formatting Round-Trip (Property 3)
    - **Property 3: Currency Formatting Round-Trip**
    - Generate random non-negative integers up to 10^12
    - Verify `parseRupiah(formatRupiah(amount)) === amount` for all generated values
    - **Validates: Requirements 14.2, 3.5**

  - [x] 4.3 Write property test for Donation Amount Validation (Property 5)
    - **Property 5: Donation Amount Validation**
    - Generate random amounts around the Rp1.000 threshold boundary
    - Verify amounts below minimum are rejected, amounts at/above minimum and at/below maximum are accepted
    - **Validates: Requirements 6.8**

  - [x] 4.4 Write property test for Relative Timestamp Correctness (Property 9)
    - **Property 9: Relative Timestamp Correctness**
    - Generate random time deltas (minutes, hours, days in past and future)
    - Verify correct Indonesian format: "X menit yang lalu", "X jam yang lalu", "X hari lagi"
    - **Validates: Requirements 14.4**

  - [x] 4.5 Write property test for Zakat Calculation Correctness (Property 10)
    - **Property 10: Zakat Calculation Correctness**
    - Generate random (assets, nisab) pairs
    - Verify: returns 2.5% of (assets - nisab) when assets > nisab, returns 0 when assets <= nisab, result is always non-negative integer
    - **Validates: Requirements 15.3**

- [x] 5. Layout Components with Animations
  - [x] 5.1 Create BottomNavBar with spring animation on active tab indicator
    - Implement `BottomNavBarProps` interface: activeTab, unreadCount
    - 5 tabs: Home, Galang Dana, Donasi Saya, Inbox, Akun with icons
    - Active tab indicator slides with Framer Motion spring animation
    - Show unread badge on Inbox tab, hide entire bar on desktop (>1024px)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 5.2 Create DesktopHeader with search bar and user menu
    - Implement `DesktopHeaderProps` interface: user, notificationCount, onSearch
    - Logo, search bar, navigation links (Donasi, Galang Dana, Zakat), user avatar/login button
    - Show only on desktop viewports (>1024px)
    - _Requirements: 10.5, 13.1_

  - [x] 5.3 Create PageTransition component with Framer Motion
    - Implement `PageTransitionProps` interface: children, direction (up/fade)
    - Wrap route changes with `AnimatePresence` — fade + slide-up (200ms ease-out)
    - Configure as layout wrapper in root `app/layout.tsx`
    - _Requirements: 10.1_

  - [x] 5.4 Create root layout with responsive navigation switching
    - Create `app/layout.tsx` combining BottomNavBar (mobile/tablet) and DesktopHeader (desktop)
    - Integrate PageTransition wrapper for animated route changes
    - Add global providers: NextAuth SessionProvider, Zustand store
    - _Requirements: 10.4, 10.5_

  - [x] 5.5 Create SearchBar component
    - Search icon + placeholder "Cari yang ingin kamu bantu..."
    - Navigate to `/search?q=...` on submit
    - _Requirements: 5.5, 13.1_

- [x] 6. Campaign Card and Grid Components with Skeletons
  - [x] 6.1 Create CampaignCard component with all display elements
    - Implement `CampaignCardProps` interface: campaign data, variant (compact/standard), showCreator, showDaysRemaining, onClick
    - Render: cover image (16:9), title (2-line clamp), creator + VerificationBadge, ProgressBar, Rupiah amount, days remaining
    - Add card hover lift micro-interaction (translateY -2px + shadow) via Framer Motion
    - Navigate to `/campaign/[slug]` on click
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 6.2 Create CampaignCardSkeleton component
    - Implement `CampaignCardSkeletonProps` interface: variant (compact/standard), count
    - Match exact layout dimensions of CampaignCard with shimmer-animated Skeleton components
    - Support rendering multiple skeletons for grid loading states
    - _Requirements: 10.1 (loading UX)_

  - [x] 6.3 Create CampaignGrid component with infinite scroll and loading state
    - Implement `CampaignGridProps` interface: campaigns, variant, isLoading, skeletonCount, emptyMessage, onLoadMore, hasMore
    - Show CampaignCardSkeleton when `isLoading=true`
    - Use IntersectionObserver for staggered fade-in scroll animations on campaign cards
    - Trigger `onLoadMore` when bottom sentinel is visible
    - Show empty state illustration when no campaigns
    - _Requirements: 5.3, 1.6_

  - [x] 6.4 Create VerificationBadge component
    - Display badge icon with tooltip showing verification type (KTP/organization)
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [x] 6.5 Write property test for Category Filter Correctness (Property 4)
    - **Property 4: Category Filter Correctness**
    - Generate campaigns with random categories, apply filter
    - Verify: only campaigns matching selected category are returned, zero false inclusions, zero false exclusions
    - **Validates: Requirements 5.2**

  - [x] 6.6 Write property test for Search Result Relevance (Property 8)
    - **Property 8: Search Result Relevance**
    - Generate campaigns + query substrings from their title/description
    - Verify: all returned campaigns contain query string (case-insensitive) in title or description
    - **Validates: Requirements 13.2**

- [x] 7. Checkpoint - UI components and utilities verified
  - Ensure all base UI components render correctly, utility functions work, and property tests pass. Ask the user if questions arise.

- [x] 8. Campaign APIs with Caching and Error Handling
  - [x] 8.1 Create consistent API error handling layer
    - Implement `ApiError` interface with code, message, field, details, status
    - Create error helper functions: `validationError()`, `notFoundError()`, `unauthorizedError()`, `forbiddenError()`, `serverError()`
    - Implement consistent error mapping for Prisma errors (unique constraint → 409, not found → 404)
    - All error messages in Indonesian
    - _Requirements: 6.8, 7.6_

  - [x] 8.2 Create GET /api/campaigns endpoint with filtering and caching
    - Support query params: category, search, urgent, status, page, limit
    - Add `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` header
    - Return paginated results with total count
    - _Requirements: 5.2, 5.3, 13.2_

  - [x] 8.3 Create GET /api/campaigns/[slug] endpoint with ISR support
    - Return full campaign detail with creator info, donation count
    - Configure page with ISR `revalidate: 60` for campaign detail pages
    - Return 404 with proper error format if slug not found
    - _Requirements: 4.1 through 4.13_

  - [x] 8.4 Create POST /api/campaigns endpoint (authenticated, validated)
    - Require authentication and verified status
    - Validate with Zod: title (max 200), targetAmount (>0), category, coverImage, story
    - Return 403 if user is not verified
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 8.5 Create campaign sub-resource endpoints
    - GET /api/campaigns/[slug]/updates (paginated)
    - POST /api/campaigns/[slug]/updates (creator-only authorization)
    - GET /api/campaigns/[slug]/donations (paginated)
    - GET /api/campaigns/[slug]/disbursements
    - _Requirements: 4.8, 4.9, 4.10, 12.1, 12.2_

  - [x] 8.6 Create SWR hooks for campaign data fetching
    - Create `lib/hooks/useCampaigns.ts` with SWR: `revalidateOnFocus: true`, stale time 30s
    - Create `lib/hooks/useCampaignDetail.ts` for single campaign
    - Implement optimistic updates for donation submission
    - Handle SWR `onError` with toast notification ("Gagal memuat data. Coba lagi.")
    - Add automatic retry with exponential backoff (1s, 2s, 4s) up to 3 attempts
    - _Requirements: 4.3, 5.3_

  - [x] 8.7 Write property test for Donation Amount Invariant (Property 1)
    - **Property 1: Donation Amount Invariant**
    - Generate random arrays of donations with mixed payment statuses
    - Verify: sum of confirmed donations always equals collectedAmount
    - **Validates: Requirements 4.3, 6.5, 20.5**

  - [x] 8.8 Write property test for Campaign Status Consistency (Property 13)
    - **Property 13: Campaign Status Consistency**
    - Generate random (collectedAmount, targetAmount, deadline) tuples
    - Verify: if collected >= target → "completed", if past deadline and below target → "expired", otherwise → "active"
    - **Validates: Requirements 4.3, 3.7**

- [x] 9. Donation Flow and Payment APIs
  - [x] 9.1 Create DonationAmountSelector component
    - Implement `DonationAmountSelectorProps` interface: presets, minAmount, maxAmount, selectedAmount, onAmountChange, onNext, error
    - Preset buttons: Rp10.000, Rp25.000, Rp50.000, Rp100.000, Rp500.000
    - Custom input with "Rp" prefix and real-time validation
    - Disable "Next" button if amount is invalid
    - _Requirements: 6.1, 6.2, 6.3, 6.8_

  - [x] 9.2 Create PaymentMethodSelector component
    - Implement `PaymentMethodSelectorProps` interface: methods, selectedMethod, onSelect, onNext
    - Display payment methods grouped by type (bank_transfer, ewallet, credit_card) with icons and fee info
    - _Requirements: 6.4_

  - [x] 9.3 Create DonationConfirmation component
    - Implement `DonationConfirmationProps` interface: campaign, amount, paymentMethod, prayer, isAnonymous, onPrayerChange, onAnonymousToggle, onConfirm, isSubmitting
    - Summary display: campaign title, amount, payment method, fee
    - Anonymous toggle and prayer textarea (max 500 chars with counter)
    - Button enters loading state on submit, prevents double-submit
    - _Requirements: 6.5, 6.6, 6.7_

  - [x] 9.4 Create donation flow pages
    - Create `app/(main)/campaign/[slug]/donation-amount/page.tsx` — amount selection step
    - Create payment method selection step
    - Create confirmation step
    - Create success page with confirmation details and share options
    - Multi-step with per-step validation, prevent advancing until current is valid
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 9.5 Create POST /api/donations endpoint
    - Create donation record with optional prayer
    - Validate: amount >= minAmount, valid payment method, valid campaign (active status)
    - Return payment instructions (mock bank VA number / e-wallet QR)
    - _Requirements: 6.5, 6.6, 6.7_

  - [x] 9.6 Create PATCH /api/donations/[id]/confirm endpoint
    - Simulate payment webhook: update donation status to "confirmed"
    - Atomically increment campaign `collectedAmount`
    - Update campaign status to "completed" if target is met
    - Create notifications for donor and campaign creator
    - Publish prayer to prayer wall via SSE if prayer is included
    - _Requirements: 6.5, 12.4, 17.3_

  - [x] 9.7 Create GET /api/donations/mine endpoint
    - Return authenticated user's donations with campaign details, paginated
    - _Requirements: 8.1, 8.2_

- [x] 10. Balance/Wallet APIs (Donation Pocket)
  - [x] 10.1 Create GET /api/balance endpoint
    - Return current user's donation pocket balance
    - Require authentication
    - _Requirements: 20.4_

  - [x] 10.2 Create POST /api/balance/topup endpoint
    - Validate top-up amount (> 0)
    - Simulate payment and increment user's `donationBalance`
    - Return new balance
    - _Requirements: 20.1, 20.2_

  - [x] 10.3 Create POST /api/balance/donate endpoint
    - Validate: amount <= current balance, valid campaignId
    - Atomically deduct from user balance and create confirmed donation
    - Reject with 400 and current balance info if insufficient
    - Increment campaign collectedAmount
    - _Requirements: 20.3, 20.5_

  - [x] 10.4 Write property test for Balance Deduction Integrity (Property 11)
    - **Property 11: Balance Deduction Integrity**
    - Generate random (balance, donationAmount) pairs
    - Verify: if amount <= balance, new balance = balance - amount; if amount > balance, transaction rejected and balance unchanged
    - **Validates: Requirements 16.6, 20.5**

- [x] 11. Checkpoint - APIs and donation flow working
  - Ensure all campaign, donation, and balance APIs return correct responses. Verify donation flow creates records and updates campaign amounts. Ask the user if questions arise.

- [x] 12. Prayer Wall with SSE Real-time Updates
  - [x] 12.1 Create GET /api/prayers endpoint (paginated)
    - Return recent prayers across all campaigns in reverse chronological order
    - Include donor name (or "Anonim"), avatar, campaign link, prayer text, amiin count
    - _Requirements: 9.1, 9.2, 9.4_

  - [x] 12.2 Create GET /api/prayers/stream SSE endpoint
    - Keep connection open using `ReadableStream` in Next.js Route Handler
    - Push new prayers as they arrive in real-time
    - Implement backpressure: batch prayers if >5 arrive within 2 seconds
    - Handle client disconnect gracefully
    - _Requirements: 9.1 (real-time prayer feed)_

  - [x] 12.3 Create POST /api/prayers/[id]/amiin endpoint
    - Increment amiin count atomically
    - Return new count
    - Validate prayer exists
    - _Requirements: 9.3_

  - [x] 12.4 Create usePrayerStream hook
    - Implement `lib/hooks/usePrayerStream.ts`
    - Connect to SSE endpoint, buffer incoming prayers, merge with initial SWR data
    - Fallback: if SSE connection drops, fall back to SWR polling every 30 seconds
    - Automatic reconnect after 3 seconds on connection drop
    - After 3 failed reconnections, stay on polling mode
    - _Requirements: 9.1, 1.8_

  - [x] 12.5 Create PrayerWall component with SSE integration
    - Implement `PrayerWallProps` interface: initialPrayers, maxVisible, showCampaignLink, variant (homepage/campaign-detail)
    - Connect to SSE stream on mount, disconnect on unmount
    - Optimistic amiin count increment (revert on API failure with toast)
    - Display prayers with avatar, name, timestamp, campaign link, text, amiin button with pulse animation
    - _Requirements: 1.8, 9.1, 9.2, 9.3_

  - [x] 12.6 Write property test for Prayer Chronological Ordering (Property 6)
    - **Property 6: Prayer Chronological Ordering**
    - Generate random timestamp arrays, apply sort function
    - Verify: prayers are in strictly descending createdAt order
    - **Validates: Requirements 9.1**

  - [x] 12.7 Write property test for Amiin Count Monotonic Increment (Property 7)
    - **Property 7: Amiin Count Monotonic Increment**
    - Generate random starting counts, apply amiin operation
    - Verify: count becomes exactly N + 1, never decreases
    - **Validates: Requirements 9.3**

  - [x] 12.8 Write property test for Prayer-Donation Pairing Uniqueness (Property 12)
    - **Property 12: Prayer-Donation Pairing Uniqueness**
    - Generate donation/prayer pairs
    - Verify: each prayer references exactly one donation (unique donationId), each donation has at most one prayer
    - **Validates: Requirements 9.1, 6.6**

- [x] 13. Homepage with All Sections
  - [x] 13.1 Create HeroBanner component with auto-rotating carousel
    - Implement `HeroBannerProps` interface: slides array with image/headline/cta, autoPlayInterval
    - Auto-rotate with dot indicators, swipe support on mobile
    - 5-second default interval
    - _Requirements: 1.1_

  - [x] 13.2 Create QuickActionTiles grid component
    - Implement `QuickActionTilesProps` interface: tiles array with icon/label/href/color
    - Grid of circular icon tiles: Donasi, Zakat, Galang Dana, Donasi Otomatis, etc.
    - _Requirements: 1.2_

  - [x] 13.3 Create UrgentCampaigns section with horizontal scroll
    - Horizontally scrollable list of Campaign cards with `isUrgent=true`
    - Use compact CampaignCard variant
    - Show CampaignCardSkeleton during loading
    - _Requirements: 1.3_

  - [x] 13.4 Create remaining homepage sections
    - "Yang Baru di Kitabisa" carousel with campaign banners
    - "Program Donasi Berkelanjutan" section with CampaignCards
    - "Pilihan Kitabisa" grid (up to 12 campaigns) with "Lihat semua" link
    - CategorySection with category icons and filtered campaign cards
    - "Tentang Kitabisa" info section
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.9_

  - [x] 13.5 Assemble homepage with ISR caching
    - Create `app/(main)/page.tsx` composing all sections
    - Configure ISR with `revalidate: 300` (5 minutes)
    - Show page-level skeleton loading state (full-page skeleton matching target layout)
    - Integrate PrayerWall with SSE
    - _Requirements: 1.1 through 1.9_

- [x] 14. Campaign Detail Page
  - [x] 14.1 Create campaign detail page with ISR
    - Create `app/(main)/campaign/[slug]/page.tsx`
    - Configure ISR with `revalidate: 60`
    - Show full-page skeleton during loading (image skeleton + content blocks)
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 14.2 Create CampaignDetail component with tabs and sub-sections
    - Implement `CampaignDetailProps` interface: campaign, onDonate, onShare
    - Full-width cover image, campaign info header (title, amounts, days, donation count)
    - Tab navigation: Kabar Terbaru, Pencairan Dana, Story
    - CampaignStory component rendering HTML content
    - CampaignUpdates section with timestamps and images
    - Disbursement records display
    - Campaign creator info with VerificationBadge
    - _Requirements: 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 14.3 Create fixed bottom "Donasi sekarang" CTA and share button
    - Fixed bottom CTA button navigating to donation flow
    - Share button opening ShareModal
    - Button loading state on donation action
    - _Requirements: 4.12, 4.13_

  - [x] 14.4 Create campaign prayer section with amiin interaction
    - Display donor prayers with timestamps and amiin button
    - Optimistic amiin increment with pulse animation
    - Load more pagination
    - _Requirements: 4.11, 9.3_

- [x] 15. SEO Infrastructure
  - [x] 15.1 Create SEOHead component and metadata generation
    - Implement `SEOHeadProps` interface: title, description, image, url, type, structuredData
    - Generate og:title, og:description, og:image, twitter:card=summary_large_image
    - Add canonical URL via `<link rel="canonical">`
    - _Requirements: 18.4_

  - [x] 15.2 Configure dynamic metadata for campaign pages
    - Use Next.js `generateMetadata()` in campaign detail page
    - Pull og:title, og:description, og:image from campaign data
    - Add JSON-LD structured data (DonateAction, Organization)
    - _Requirements: 18.4_

  - [x] 15.3 Create auto-generated sitemap.xml
    - Create `app/sitemap.ts` listing all active campaigns with `lastmod` based on `updatedAt`
    - Include homepage, category pages, and all active campaign URLs
    - _Requirements: 5.3, 18.4_

- [x] 16. Authentication Pages
  - [x] 16.1 Create registration page
    - Create `app/(auth)/register/page.tsx` with email, name, password fields
    - Form validation: required fields, email format, password strength
    - Handle 409 (duplicate email) error display
    - _Requirements: 7.1_

  - [x] 16.2 Create login page with OAuth
    - Create `app/(auth)/login/page.tsx` with email/password and Google OAuth button
    - Handle invalid credentials error display
    - Redirect to homepage on successful login
    - Rate limit display: lock account message after 5 failed attempts
    - _Requirements: 7.2, 7.3, 7.4, 7.6_

  - [x] 16.3 Create auth middleware and account page
    - Create middleware protecting authenticated routes (donasi-saya, inbox, akun, campaign/create)
    - Create `app/(main)/akun/page.tsx` with user profile, balance display, settings
    - Handle expired session: silent token refresh or redirect to login
    - _Requirements: 7.5, 20.4_

- [x] 17. Checkpoint - Core features integrated
  - Ensure homepage renders with real data, campaign detail pages work with ISR, donation flow completes end-to-end, SSE prayer wall streams data, and auth flow works. Ask the user if questions arise.

- [x] 18. Explore, Search, and Category Pages
  - [x] 18.1 Create explore all page with infinite scroll
    - Create `app/(main)/explore/all/page.tsx` with CampaignGrid (infinite scroll via IntersectionObserver)
    - Show bottom loading indicator (3 skeleton cards) when fetching next page
    - Show empty state when no campaigns
    - _Requirements: 5.3, 5.4_

  - [x] 18.2 Create category page with filtered campaigns
    - Create `app/(main)/explore/[category]/page.tsx`
    - Static generation for category pages at build time
    - Filter campaigns by category slug
    - Empty state: "Belum ada campaign di kategori ini"
    - _Requirements: 5.1, 5.2_

  - [x] 18.3 Create search page
    - Create `app/(main)/search/page.tsx` with keyword search and results
    - Search by title and description (case-insensitive)
    - Empty state: "Tidak ditemukan campaign dengan kata kunci tersebut" + suggested categories
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 19. Donation Tracking and Notifications
  - [x] 19.1 Create Donasi Saya page
    - Create `app/(main)/donasi-saya/page.tsx` listing donation history
    - Donation record card: campaign title, amount, date, payment status
    - Navigate to campaign detail on tap
    - Empty state: "Anda belum pernah berdonasi" + CTA to explore
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 19.2 Create Notification APIs and Inbox page
    - Create GET /api/notifications endpoint (paginated, authenticated)
    - Create PATCH /api/notifications/read endpoint
    - Create GET /api/notifications/unread-count endpoint
    - Create `app/(main)/inbox/page.tsx` displaying notifications list
    - Add unread badge count to BottomNavBar Inbox tab
    - Empty state: "Tidak ada notifikasi baru"
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 19.3 Create notification generation logic
    - Trigger notifications on: donation confirmed, campaign update posted, disbursement created
    - Create notification records in database
    - _Requirements: 12.4, 17.2, 17.3, 17.4_

- [x] 20. Campaign Creation (Galang Dana)
  - [x] 20.1 Create campaign creation form page
    - Create `app/(main)/campaign/create/page.tsx`
    - Multi-step form: title, target amount, deadline, category, cover image upload, story (rich text)
    - Per-step validation, prevent advancing until current is valid
    - KYC verification gate: show verification prompt for unverified users
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 20.2 Create file upload API
    - Create POST /api/upload endpoint for campaign cover images
    - Validate: file size (<5MB), file type (image/jpeg, image/png, image/webp)
    - Return 413 for oversized files, 400 for invalid types
    - Store locally (production: S3-compatible)
    - Client-side preview validation before upload
    - _Requirements: 11.2_

- [x] 21. Zakat Feature
  - [x] 21.1 Create Zakat page and calculator
    - Create `app/(main)/zakat/page.tsx` with type selection (Mal, Fitrah, Infaq, Sedekah)
    - Create calculator form with asset inputs
    - Implement 2.5% calculation logic with nisab threshold
    - Navigate to donation flow with calculated amount
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 21.2 Create Zakat APIs
    - Create POST /api/zakat/calculate endpoint
    - Create GET /api/zakat/campaigns endpoint (zakat-specific campaigns)
    - _Requirements: 15.3, 15.4_

- [x] 22. Automatic Donations (Donasi Otomatis)
  - [x] 22.1 Create Donasi Otomatis page and configuration
    - Create `app/(main)/donasi-otomatis/page.tsx` with setup form
    - Form: amount, category selector, schedule (daily/weekly), time (HH:mm)
    - Display Donation Pocket balance and top-up CTA
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 22.2 Create auto-donation APIs
    - Create POST /api/auto-donations endpoint to save settings
    - Create auto-donation processing logic (scheduled execution simulation)
    - Notify user when balance insufficient
    - _Requirements: 16.5, 16.6_

- [x] 23. Social Sharing
  - [x] 23.1 Create ShareModal component
    - Implement `ShareModalProps` interface: isOpen, onClose, campaign (title/slug/coverImage/description)
    - Share options: WhatsApp, Facebook, Twitter, Copy Link
    - Generate OG-friendly URL with campaign metadata
    - Copy link with visual feedback (checkmark)
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

- [x] 24. Responsive Design Polish
  - [x] 24.1 Implement mobile-first responsive styles
    - Mobile (320-480px): Single column, full-width cards, horizontal scrollable sections
    - Tablet (481-1024px): 2-column grid, expanded spacing
    - Desktop (1025px+): 3-4 column grid, max-width 1200px container, sidebar for campaign detail
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 24.2 Verify responsive navigation behavior
    - BottomNavBar visible only on mobile/tablet, hidden on desktop
    - DesktopHeader visible only on desktop
    - Match kitabisa.com typography across breakpoints
    - _Requirements: 10.4, 10.5, 10.6, 10.7_

- [x] 25. Data Seeding
  - [x] 25.1 Create comprehensive seed script
    - 8 categories with icons (matching kitabisa.com)
    - 30+ campaigns across categories with realistic Indonesian content
    - 10 users (mix of donors and verified creators)
    - 100+ donations with varied amounts and statuses
    - 50+ prayers with realistic Indonesian text
    - Campaign updates and disbursement records
    - Urgent and featured campaigns for homepage sections
    - Sample notifications for test users
    - _Requirements: All (sample data for all features)_

- [x] 26. Checkpoint - Full feature integration complete
  - Ensure all pages render, all APIs work, SSE streams, animations play, responsive design matches kitabisa.com, and seeded data populates all sections. Ask the user if questions arise.

- [x] 27. Integration and E2E Tests
  - [x] 27.1 Write integration tests for donation flow
    - Test: create donation → confirm payment → verify campaign amount updates
    - Test: donate from balance → verify deduction
    - Test: donation with prayer → verify prayer appears
    - _Requirements: 6.5, 20.5, 6.6_

  - [x] 27.2 Write integration tests for campaign and search
    - Test: create campaign → verify in database → verify appears in list
    - Test: seed campaigns → search by keyword → verify results match
    - _Requirements: 11.4, 13.2_

  - [x] 27.3 Write integration tests for auth and notifications
    - Test: register → login → verify session → access protected routes
    - Test: confirm donation → verify notifications created for donor + creator
    - _Requirements: 7.1, 7.2, 7.4, 17.2, 17.3_

  - [x] 27.4 Write E2E tests with Playwright
    - Donor journey: Homepage → browse → campaign detail → donate → confirmation
    - Creator journey: Login → create campaign → post update → view donations
    - Search flow: Homepage → search → filter category → view campaign
    - Mobile navigation: Navigate all tabs, verify active states
    - Run at mobile (375px), tablet (768px), and desktop (1440px) viewports
    - _Requirements: All (critical user journeys)_

  - [x] 27.5 Write component tests for key UI components
    - CampaignCard: renders all fields, truncates title, shows badge when verified
    - ProgressBar: correct width %, capped at 100%, animated on mount
    - DonationAmountSelector: preset buttons work, custom input validates, min/max enforced
    - PrayerWall: renders prayers in order, amiin button works
    - BottomNavBar: active state correct, hidden on desktop, badge shows count
    - ShareModal: all share options present, generates correct URLs
    - _Requirements: 3.1-3.8, 9.1-9.4, 2.1-2.4_

- [x] 28. Final Checkpoint - All tests pass
  - Ensure all property tests, unit tests, integration tests, and E2E tests pass. Verify responsive design matches kitabisa.com across mobile, tablet, and desktop viewports. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (13 total)
- TypeScript is used throughout as specified in the design document
- SWR caching strategy: `revalidateOnFocus: true`, 30s stale time for client-side data
- ISR strategy: 60s for campaign detail, 300s for homepage, static for categories
- Framer Motion is used for all page transitions and micro-interactions
- SSE is the primary real-time mechanism for prayer wall with SWR polling as fallback
- All API errors use the consistent `ApiError` format with Indonesian messages

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "1.6"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 3, "tasks": ["3.7", "4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.5"] },
    { "id": 5, "tasks": ["5.4", "6.1", "6.2", "6.4"] },
    { "id": 6, "tasks": ["6.3", "6.5", "6.6"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
    { "id": 8, "tasks": ["8.5", "8.6", "8.7", "8.8"] },
    { "id": 9, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 10, "tasks": ["9.4", "9.5"] },
    { "id": 11, "tasks": ["9.6", "9.7", "10.1", "10.2", "10.3"] },
    { "id": 12, "tasks": ["10.4", "12.1", "12.2", "12.3"] },
    { "id": 13, "tasks": ["12.4", "12.5"] },
    { "id": 14, "tasks": ["12.6", "12.7", "12.8", "13.1", "13.2"] },
    { "id": 15, "tasks": ["13.3", "13.4", "13.5"] },
    { "id": 16, "tasks": ["14.1", "14.2", "14.3", "14.4"] },
    { "id": 17, "tasks": ["15.1", "15.2", "15.3"] },
    { "id": 18, "tasks": ["16.1", "16.2", "16.3"] },
    { "id": 19, "tasks": ["18.1", "18.2", "18.3"] },
    { "id": 20, "tasks": ["19.1", "19.2", "19.3"] },
    { "id": 21, "tasks": ["20.1", "20.2"] },
    { "id": 22, "tasks": ["21.1", "21.2", "22.1", "22.2"] },
    { "id": 23, "tasks": ["23.1", "24.1", "24.2"] },
    { "id": 24, "tasks": ["25.1"] },
    { "id": 25, "tasks": ["27.1", "27.2", "27.3"] },
    { "id": 26, "tasks": ["27.4", "27.5"] }
  ]
}
```
