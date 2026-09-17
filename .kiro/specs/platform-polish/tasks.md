# Implementation Plan: Platform Polish

## Overview

This plan implements 8 platform polish features: static informational pages, user settings, my campaigns page, notification bell navigation, top-up dialog, verification dialog, search category filtering, and footer component extraction. Each task builds incrementally, starting with data layer changes, then shared infrastructure, then feature implementations, and finally wiring everything together.

## Tasks

- [x] 1. Database migration and shared hooks
  - [x] 1.1 Add TopUp model to Prisma schema and run migration
    - Add `TopUp` model to `prisma/schema.prisma` with fields: id, amount, paymentMethod, status, userId, createdAt
    - Add `topUps TopUp[]` relation to User model
    - Run `npx prisma migrate dev --name add_topup_model`
    - _Requirements: 5.7_

  - [x] 1.2 Create shared `useUnreadCount` hook
    - Create `src/lib/hooks/useUnreadCount.ts`
    - Uses `useSWR` to fetch `/api/notifications/unread-count` when authenticated
    - Returns `{ unreadCount, refreshCount }` — reads `data?.count` from existing API
    - 30s refresh interval, revalidateOnFocus: true
    - _Requirements: 4.2, 4.7_

- [x] 2. Footer extraction and static page infrastructure
  - [x] 2.1 Extract Footer component and create ConditionalFooter
    - Create `src/components/layout/Footer.tsx` — extract footer JSX from `src/app/page.tsx`
    - Convert all `<a>` tags to Next.js `<Link>` components pointing to static pages
    - Use `hidden lg:block` for desktop-only rendering
    - Create `src/components/layout/ConditionalFooter.tsx` — client component using `usePathname()` to hide on /login, /register, /admin/*, /moderasi/*
    - Integrate `<ConditionalFooter />` in `src/app/layout.tsx` after `{children}`
    - Remove inline footer from `src/app/page.tsx`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 2.2 Create `(static)` route group layout
    - Create `src/app/(static)/layout.tsx` — shared wrapper with max-w-4xl, centered content, flex column layout
    - Footer NOT included here (ConditionalFooter in root layout handles it)
    - _Requirements: 1.9, 1.10_

  - [x] 2.3 Create static pages (about, careers, press, help)
    - Create `src/app/(static)/about/page.tsx` — heading "Tentang Kami", 200+ chars content, metadata export
    - Create `src/app/(static)/careers/page.tsx` — heading "Karir", placeholder career info, metadata
    - Create `src/app/(static)/press/page.tsx` — heading "Media", placeholder press info, metadata
    - Create `src/app/(static)/help/page.tsx` — heading "Help Center", 3+ categorized help topics, metadata
    - All are server components, no auth required
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.9, 1.10, 1.11_

  - [x] 2.4 Create static pages (faq, contact, terms, privacy)
    - Create `src/app/(static)/faq/page.tsx` — heading "FAQ", 5+ questions in accordion (client component), metadata
    - Create `src/app/(static)/contact/page.tsx` — heading "Kontak", contact methods (email, phone, social), metadata
    - Create `src/app/(static)/terms/page.tsx` — heading "Syarat & Ketentuan", terms text, metadata
    - Create `src/app/(static)/privacy/page.tsx` — heading "Kebijakan Privasi", privacy text, metadata
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11_

  - [x] 2.5 Write property tests for static pages accessibility
    - **Property 1: Static Pages Accessibility**
    - Verify all 8 static pages return HTTP 200 and render heading text without authentication
    - **Validates: Requirements 1.9, 1.10**

- [x] 3. Checkpoint - Ensure footer and static pages work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. API routes for user features
  - [x] 4.1 Create `/api/user/profile` PATCH endpoint
    - Create `src/app/api/user/profile/route.ts`
    - Auth required, Zod validation for name (2-50 chars)
    - Updates `user.name` in DB, returns updated user object
    - _Requirements: 2.2, 2.3_

  - [x] 4.2 Create `/api/user/avatar` POST endpoint
    - Create `src/app/api/user/avatar/route.ts`
    - Auth required, accepts FormData with file field
    - Validates MIME type (PNG/JPG/WebP) and size (≤2MB)
    - Saves to `/public/uploads/` with unique filename, updates `user.avatar` in DB
    - _Requirements: 2.4, 2.5_

  - [x] 4.3 Create `/api/user/password` PATCH endpoint
    - Create `src/app/api/user/password/route.ts`
    - Auth required, Zod validation (currentPassword, newPassword ≥8 chars, confirmPassword match)
    - OAuth guard: if `user.password === null`, return 400 "Akun Google tidak dapat mengubah password"
    - Verify current password with bcrypt, hash new password, update DB
    - _Requirements: 2.6, 2.7, 2.8, 2.9_

  - [x] 4.4 Create `/api/user/verify` POST endpoint
    - Create `src/app/api/user/verify/route.ts`
    - Auth required, validates KTP (fullName 2-100, NIK 16 digits) or Organization (orgName 2-100, regNumber min 5)
    - Sets `isVerified=true`, `verificationType`, upgrades role to `CAMPAIGN_CREATOR`
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 4.5 Create `/api/user/topup` POST endpoint and remove old endpoint
    - Create `src/app/api/user/topup/route.ts`
    - Auth required, Zod validation (amount 10000-10000000, paymentMethod enum)
    - Uses `prisma.$transaction` to create TopUp record + increment `user.donationBalance`
    - Remove or deprecate `src/app/api/balance/topup/route.ts`
    - _Requirements: 5.4, 5.5, 5.7_

  - [x] 4.6 Create `/api/user/campaigns` GET endpoint
    - Create `src/app/api/user/campaigns/route.ts`
    - Auth required, paginated (page, limit=10)
    - Queries campaigns where `creatorId = session.user.id`, ordered by `createdAt desc`
    - Returns `{ campaigns, total, page, totalPages }`
    - _Requirements: 3.1, 3.8_

  - [x] 4.7 Create `/api/categories` GET endpoint
    - Create `src/app/api/categories/route.ts`
    - Public (no auth), returns all categories ordered by `order asc`
    - Sets `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`
    - _Requirements: 7.1_

  - [x] 4.8 Write property tests for API validation
    - **Property 3: Password Security** — wrong current password always returns 400, never modifies stored hash
    - **Property 4: Avatar Size Constraint** — files >2MB always rejected before writing to disk
    - **Property 5: Verification Role Upgrade** — successful verification always upgrades DONOR to CAMPAIGN_CREATOR
    - **Property 6: Top-Up Amount Bounds** — amount always validated between 10000 and 10000000 inclusive
    - **Validates: Requirements 2.7, 2.5, 6.5, 5.4, 5.5**

- [x] 5. Checkpoint - Ensure API routes pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Notification bell and AppShell fixes
  - [x] 6.1 Fix AppShell to pass session user to DesktopHeader and use shared hook
    - In `src/components/layout/AppShell.tsx`:
      - Import `useUnreadCount` hook (replace inline useSWR)
      - Get session data: change to `const { data: session, status } = useSession()`
      - Pass `user={session?.user ?? null}` to `<DesktopHeader>` (currently passes `null`)
      - Pass `notificationCount={unreadCount}` to `<DesktopHeader>`
    - _Requirements: 4.5, 4.2_

  - [x] 6.2 Convert notification bell to Link in DesktopHeader
    - In `src/components/layout/DesktopHeader.tsx`:
      - Replace the bell `<button>` with `<Link href="/inbox">` wrapping the same icon SVG
      - Keep existing badge rendering logic unchanged
    - _Requirements: 4.1, 4.3, 4.4_

  - [x] 6.3 Write property test for bell navigation
    - **Property 9: Bell Navigation Consistency**
    - Verify notification bell click always navigates authenticated users to `/inbox`
    - **Validates: Requirements 4.1**

- [x] 7. User Settings page implementation
  - [x] 7.1 Create user settings page
    - Create `src/app/akun/pengaturan/page.tsx` (client component)
    - Sections: ProfileSection (avatar upload + name form), PasswordSection (3 fields), EmailDisplay (read-only)
    - Uses `useSession()` for current user data
    - Name update calls `PATCH /api/user/profile`, avatar calls `POST /api/user/avatar`, password calls `PATCH /api/user/password`
    - Client-side validation with inline error messages, loading states, success toasts
    - Redirect to `/login` if unauthenticated
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [x] 7.2 Write property test for profile name persistence
    - **Property 2: Round trip consistency**
    - Verify profile name updates persist in database and reflect in next session refresh
    - **Validates: Requirements 2.2, 2.3**

- [x] 8. My Campaigns page implementation
  - [x] 8.1 Create my campaigns page
    - Create `src/app/akun/kampanye-saya/page.tsx` (client component)
    - Uses `useSWR` to fetch `/api/user/campaigns?page=N&limit=10`
    - Renders campaign cards with: cover image, title, status badge, progress bar, amounts
    - Campaign cards link to `/campaign/[slug]`
    - Pagination controls (prev/next + page numbers)
    - Empty state: DONOR shows "Anda belum memiliki kampanye" + CTA to verify; CAMPAIGN_CREATOR shows CTA to create
    - Redirect to `/login` if unauthenticated
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8_

  - [x] 8.2 Fix "Galang Dana Saya" link on Account page
    - In `src/app/akun/page.tsx`, change `SettingsLink` for "Galang Dana Saya" href from `/campaign/create` to `/akun/kampanye-saya`
    - _Requirements: 3.5_

- [x] 9. Top Up and Verification dialogs
  - [x] 9.1 Create TopUpDialog component
    - Create `src/components/dialogs/TopUpDialog.tsx`
    - Multi-step: Step 1 (amount selection with presets + custom input), Step 2 (payment method), Step 3 (confirmation)
    - Props: `isOpen`, `onClose`, `onSuccess`
    - Validation: amount 10k-10M, numeric-only custom input, payment method required
    - Calls `POST /api/user/topup` on confirm
    - Modal behavior: backdrop click closes, ESC closes, X button closes, reset state on close
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 9.2 Create VerificationDialog component
    - Create `src/components/dialogs/VerificationDialog.tsx`
    - Multi-step: Step 1 (type selection: KTP or Organization), Step 2a (KTP form) or Step 2b (Org form), Step 3 (success)
    - Props: `isOpen`, `onClose`, `onSuccess`
    - Validation: KTP (fullName 2-100, NIK 16 digits), Org (orgName 2-100, regNumber min 5)
    - Calls `POST /api/user/verify` on submit
    - On success calls `update()` from next-auth to refresh session
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9_

  - [x] 9.3 Wire dialogs into Account page
    - In `src/app/akun/page.tsx`:
      - Import TopUpDialog and VerificationDialog
      - Add state: `topUpOpen`, `verifyOpen`
      - Wire "Top Up" button `onClick` to open TopUpDialog
      - Wire "Verifikasi" button `onClick` to open VerificationDialog
      - On TopUpDialog success → refetch balance
      - On VerificationDialog success → refresh session
      - For already-verified users: show verification status badge instead of "Verifikasi" button
    - _Requirements: 5.1, 6.1, 6.8_

- [x] 10. Search category filtering
  - [x] 10.1 Create CategoryFilter component
    - Create `src/components/search/CategoryFilter.tsx`
    - Props: `categories`, `activeSlug`, `onSelect`
    - Renders horizontally scrollable pill buttons ("Semua" + all categories)
    - Active category highlighted with primary color
    - Click toggles: same category deselects, different selects
    - _Requirements: 7.1, 7.2, 7.5_

  - [x] 10.2 Integrate CategoryFilter into Search page
    - In `src/app/search/page.tsx`:
      - Fetch categories using `useSWR('/api/categories')`
      - Read `category` from `useSearchParams()`
      - Pass `category` to existing `useCampaigns({ search: query, category })` hook
      - On category select → update URL with `router.push(/search?q=...&category=...)`
      - Add empty state for zero category results: "Tidak ada kampanye ditemukan dalam kategori ini"
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 10.3 Write property test for search filter intersection
    - **Property 7: Search Filter Intersection**
    - Verify category filter combined with search query returns the intersection of both filters
    - **Validates: Requirements 7.4**

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The existing `/api/notifications/unread-count` endpoint is reused — no new route needed
- The `AppShell` fix (task 6.1) is critical — without it the notification bell and user avatar are invisible on desktop
- The old `/api/balance/topup` should be removed after task 4.5 is complete
- All client components use `useSession()` for auth state and redirect to `/login` when unauthenticated

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "4.7"] },
    { "id": 3, "tasks": ["2.5", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6"] },
    { "id": 4, "tasks": ["4.8", "6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "7.1", "8.1", "8.2"] },
    { "id": 6, "tasks": ["7.2", "9.1", "9.2"] },
    { "id": 7, "tasks": ["9.3", "10.1"] },
    { "id": 8, "tasks": ["10.2"] },
    { "id": 9, "tasks": ["10.3"] }
  ]
}
```
