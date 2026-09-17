# Design Document: Platform Polish

## Overview

This design covers the implementation of 8 platform polish features that eliminate dead links, wire up non-functional buttons, and fill critical feature gaps in the Fund for Indonesia platform. The scope includes: 8 static informational pages, user settings page, my campaigns page, notification bell navigation, top-up dialog, verification dialog, search category filtering, and footer component extraction.

## Architecture

## Components and Interfaces

### New Pages (Server Components):
- `src/app/about/page.tsx`
- `src/app/careers/page.tsx`
- `src/app/press/page.tsx`
- `src/app/help/page.tsx`
- `src/app/faq/page.tsx`
- `src/app/contact/page.tsx`
- `src/app/terms/page.tsx`
- `src/app/privacy/page.tsx`
- `src/app/akun/pengaturan/page.tsx` (client component)
- `src/app/akun/kampanye-saya/page.tsx` (client component)

**New Components:**
- `src/components/layout/Footer.tsx` — extracted reusable footer
- `src/components/layout/StaticPageLayout.tsx` — shared layout for info pages
- `src/components/dialogs/TopUpDialog.tsx` — top-up modal
- `src/components/dialogs/VerificationDialog.tsx` — verification modal
- `src/components/search/CategoryFilter.tsx` — category filter bar

**Modified Components:**
- `src/components/layout/DesktopHeader.tsx` — bell click navigates to `/inbox`
- `src/components/layout/BottomNavBar.tsx` — unread count badge on inbox tab
- `src/app/akun/page.tsx` — wire Top Up + Verifikasi buttons, fix "Galang Dana Saya" link
- `src/app/search/page.tsx` — add category filter integration
- `src/app/page.tsx` — replace inline footer with `<Footer />` component
- `src/app/layout.tsx` — integrate Footer conditionally

**New API Endpoints:**
- `src/app/api/user/profile/route.ts` — PATCH profile (name)
- `src/app/api/user/password/route.ts` — PATCH password change (with OAuth guard)
- `src/app/api/user/avatar/route.ts` — POST avatar upload
- `src/app/api/user/verify/route.ts` — POST verification submission
- `src/app/api/user/topup/route.ts` — POST create top-up record + credit balance (replaces /api/balance/topup)
- `src/app/api/user/campaigns/route.ts` — GET user's campaigns
- `src/app/api/categories/route.ts` — GET all categories
- ~~`src/app/api/notifications/unread-count/route.ts`~~ — ALREADY EXISTS, no new route needed

### API Design

#### GET `/api/notifications/unread-count`
- **Auth:** Required (session-based)
- **Response:** `{ count: number }` (matches existing API response shape)
- **Query:** `prisma.notification.count({ where: { userId, isRead: false } })`
- **Note:** This endpoint already exists — no new route needed, just consume it from the shared hook

#### PATCH `/api/user/profile`
- **Auth:** Required
- **Request:** `{ name: string }` (2-50 chars)
- **Response:** `{ user: { id, name, email, avatar } }`
- **Validation:** Zod schema, name length 2-50

#### POST `/api/user/avatar`
- **Auth:** Required
- **Request:** `FormData` with `file` field (PNG/JPG/WebP, max 2MB)
- **Response:** `{ avatar: string }` (URL path to uploaded file)
- **Storage:** Save to `/public/uploads/` with unique filename

#### PATCH `/api/user/password`
- **Auth:** Required
- **Request:** `{ currentPassword: string, newPassword: string, confirmPassword: string }`
- **Response:** `{ message: "Password berhasil diubah" }`
- **Validation:** currentPassword must match, newPassword ≥ 8 chars, must match confirm
- **OAuth guard:** If `user.password` is null (Google-authenticated users), return 400 `{ error: "Akun Google tidak dapat mengubah password" }`

#### POST `/api/user/verify`
- **Auth:** Required
- **Request:** `{ type: "ktp" | "organization", fullName?: string, nik?: string, orgName?: string, regNumber?: string }`
- **Response:** `{ user: { id, isVerified, verificationType, role } }`
- **Side effects:** Sets `isVerified=true`, `verificationType`, upgrades role to `CAMPAIGN_CREATOR`

#### POST `/api/user/topup`
- **Auth:** Required
- **Request:** `{ amount: number, paymentMethod: string }`
- **Response:** `{ topUp: { id, amount, paymentMethod, status, createdAt }, balance: number }`
- **Validation:** amount 10000-10000000, paymentMethod in allowed list
- **Side effects:** Creates TopUp record with status "pending", then immediately increments `user.donationBalance` (same as existing `/api/balance/topup` behavior but with payment method tracking)
- **Migration note:** This endpoint REPLACES the existing `/api/balance/topup`. The old endpoint should be deprecated/removed after this is implemented.

#### GET `/api/user/campaigns`
- **Auth:** Required
- **Request query:** `?page=1&limit=10`
- **Response:** `{ campaigns: Campaign[], total: number, page: number, totalPages: number }`
- **Query:** Campaigns where `creatorId = session.user.id`, ordered by `createdAt desc`

#### GET `/api/categories`
- **Auth:** None required (public)
- **Response:** `{ categories: { id, name, slug, icon, order }[] }`
- **Query:** `prisma.category.findMany({ orderBy: { order: 'asc' } })`
- **Cache:** `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`

## Data Models

```prisma
// NEW MODEL — add to schema.prisma
model TopUp {
  id            String   @id @default(cuid())
  amount        Int
  paymentMethod String
  status        String   @default("pending") // "pending" | "confirmed" | "failed"
  userId        String
  createdAt     DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
}
```

**User model addition:**
```prisma
// Add relation to User model
topUps TopUp[]
```

No other model changes needed — the existing `User`, `Notification`, `Campaign`, and `Category` models already contain all required fields.

---

## Detailed Design

### 1. Static Informational Pages

**File structure:**
```
src/app/(static)/
├── about/page.tsx
├── careers/page.tsx
├── press/page.tsx
├── help/page.tsx
├── faq/page.tsx
├── contact/page.tsx
├── terms/page.tsx
├── privacy/page.tsx
└── layout.tsx          ← StaticPageLayout wrapper
```

Using a route group `(static)` with a shared layout allows all informational pages to share the same visual shell without affecting the URL structure.

**Shared Layout (`src/app/(static)/layout.tsx`):**
```tsx
// Note: Footer is NOT included here — it's rendered by ConditionalFooter in root layout
export default function StaticPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-4xl mx-auto px-4 py-8 md:py-12">
        {children}
      </main>
    </div>
  );
}
```

**Page pattern (example: `src/app/(static)/about/page.tsx`):**
```tsx
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tentang Kami - Fund for Indonesia',
  description: 'Pelajari lebih lanjut tentang Fund for Indonesia...',
};

export default function AboutPage() {
  return (
    <article>
      <h1 className="text-2xl font-bold text-text mb-6">Tentang Kami</h1>
      {/* 200+ chars of content */}
    </article>
  );
}
```

**SEO approach:** Each page exports a `metadata` object with `title` and `description`. All pages are static React Server Components — no data fetching needed, fully SSG-compatible.

**FAQ page specifics:** Uses a client-side accordion component (`'use client'` directive) for collapsible Q&A items, with at least 5 questions.

### 2. User Settings Page

**File:** `src/app/akun/pengaturan/page.tsx` (client component)

**Component structure:**
```
SettingsPage (client)
├── ProfileSection
│   ├── AvatarUpload (file input + preview)
│   └── NameForm (input + save button)
├── PasswordSection
│   ├── CurrentPasswordInput
│   ├── NewPasswordInput
│   └── ConfirmPasswordInput
└── EmailDisplay (read-only)
```

**Data flow:**
1. Page loads → `useSession()` provides current user data (name, email, image)
2. Name update → `PATCH /api/user/profile` → success toast → session refresh
3. Avatar upload → `POST /api/user/avatar` (FormData) → returns new URL → update UI
4. Password change → `PATCH /api/user/password` → success toast → clear fields

**API Implementation (`src/app/api/user/profile/route.ts`):**
```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const profileSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter").max(50, "Nama maksimal 50 karakter"),
});

export async function PATCH(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const result = profileSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Validasi gagal", fieldErrors: result.error.flatten().fieldErrors }, { status: 400 });

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { name: result.data.name },
    select: { id: true, name: true, email: true, avatar: true },
  });

  return NextResponse.json({ user });
}
```

**Avatar upload (`src/app/api/user/avatar/route.ts`):**
- Accepts `multipart/form-data`
- Validates MIME type (image/png, image/jpeg, image/webp) and size (≤ 2MB)
- Generates unique filename: `${Date.now()}-${randomId}.${ext}`
- Writes to `/public/uploads/`
- Updates `user.avatar` in DB with `/uploads/filename`
- Returns `{ avatar: "/uploads/filename" }`

**Password change (`src/app/api/user/password/route.ts`):**
```ts
const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password minimal 8 karakter"),
  confirmPassword: z.string(),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Konfirmasi password tidak cocok",
  path: ["confirmPassword"],
});
```
- Fetches user with password from DB
- **OAuth guard:** If `user.password === null` (Google-authenticated user), return 400 `{ error: "Akun Google tidak dapat mengubah password" }`
- Compares `currentPassword` with bcrypt
- If mismatch → 400 `{ error: "Password saat ini salah" }`
- Hashes new password with bcrypt (10 rounds)
- Updates `user.password` in DB

**Form validation (client-side):**
- Uses controlled inputs with `useState`
- Inline validation errors shown below each field
- Disables submit button while loading (prevents double-submit)

### 3. My Campaigns Page

**File:** `src/app/akun/kampanye-saya/page.tsx` (client component)

**Component structure:**
```
MyCampaignsPage (client)
├── PageHeader ("Galang Dana Saya")
├── CampaignList
│   └── CampaignCard (for each campaign)
│       ├── CoverImage (thumbnail)
│       ├── Title
│       ├── StatusBadge ("active" | "completed" | "expired")
│       ├── ProgressBar
│       └── AmountInfo (collected / target)
├── Pagination (prev/next, page numbers)
└── EmptyState (when no campaigns)
```

**Data fetching:**
```ts
// useSWR hook in the client component
const { data, isLoading } = useSWR(
  `/api/user/campaigns?page=${page}&limit=10`,
  fetcher
);
```

**API Implementation (`src/app/api/user/campaigns/route.ts`):**
```ts
export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = 10;
  const skip = (page - 1) * limit;

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where: { creatorId: session.user.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, slug: true, title: true, coverImage: true,
        collectedAmount: true, targetAmount: true, status: true, createdAt: true,
      },
    }),
    prisma.campaign.count({ where: { creatorId: session.user.id } }),
  ]);

  return NextResponse.json({ campaigns, total, page, totalPages: Math.ceil(total / limit) });
}
```

**Pagination approach:**
- URL state: `?page=N` query param managed with `useSearchParams`
- Shows "Sebelumnya" / "Selanjutnya" buttons + page numbers
- 10 items per page

**Empty state logic:**
- If user has `role === 'DONOR'` → show "Anda belum memiliki kampanye" + CTA to verify
- If user has `role >= CAMPAIGN_CREATOR` but 0 campaigns → show CTA to create campaign

**Account page link fix:**
- In `src/app/akun/page.tsx`, change the "Galang Dana Saya" `SettingsLink` href from `/campaign/create` to `/akun/kampanye-saya`

### 4. Notification Bell Navigation

**Modifications to `DesktopHeader.tsx`:**
- Convert the existing bell `<button>` to a Next.js `<Link href="/inbox">` element that wraps the bell icon
- The `notificationCount` prop already exists and is rendered — no badge logic change needed

**Modifications to `AppShell.tsx`:**
- Pass the actual session user to `DesktopHeader`: change `user={null}` to `user={session?.user ?? null}` (requires reading session in AppShell)
- This is CRITICAL — the bell is gated by `{user && (...)}` so passing null means it's never visible

**Unread count fetching strategy:**

Create a shared hook `src/lib/hooks/useUnreadCount.ts` to replace the inline SWR in AppShell:
```ts
import useSWR from 'swr';
import { useSession } from 'next-auth/react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useUnreadCount() {
  const { status } = useSession();

  const { data, mutate } = useSWR(
    status === 'authenticated' ? '/api/notifications/unread-count' : null,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

  // IMPORTANT: existing API returns { count }, NOT { unreadCount }
  return { unreadCount: data?.count ?? 0, refreshCount: mutate };
}
```

**API (`src/app/api/notifications/unread-count/route.ts`):**
This endpoint ALREADY EXISTS and returns `{ count: number }`. No changes needed to the API route.

**Integration points:**
- Replace the inline `useSWR` call in `AppShell.tsx` with `useUnreadCount()` hook (avoids duplicate requests)
- Pass `unreadCount` to `DesktopHeader` via `notificationCount` prop (already wired)
- Pass `unreadCount` to `BottomNavBar` via `unreadCount` prop (already wired)
- `AppShell` must also pass the user object to `DesktopHeader` (FIX: currently passes `null`)
- Count refreshes every 30s and on focus (matching existing behavior)

### 5. Top Up Dialog

**File:** `src/components/dialogs/TopUpDialog.tsx`

**Component structure:**
```
TopUpDialog (client)
├── Step 1: AmountSelection
│   ├── PresetAmountGrid (25k, 50k, 100k, 250k buttons)
│   ├── CustomAmountInput (numeric only, formatted)
│   └── NextButton (disabled until valid amount)
├── Step 2: PaymentMethodSelection
│   ├── PaymentMethodList (BCA, Mandiri, BNI, GoPay, OVO, Dana)
│   └── ConfirmButton
└── Step 3: Confirmation
    ├── SuccessIcon
    ├── SummaryText (amount + method)
    ├── PaymentInstructions (transfer instructions based on selected method)
    └── CloseButton
```

**Props interface:**
```ts
interface TopUpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void; // callback to refresh balance
}
```

**Multi-step flow state:**
```ts
type Step = 'amount' | 'payment' | 'confirmation';
const [step, setStep] = useState<Step>('amount');
const [amount, setAmount] = useState<number | null>(null);
const [paymentMethod, setPaymentMethod] = useState<string>('');
```

**Validation:**
- Amount: min Rp10.000, max Rp10.000.000
- Custom input: strip non-numeric, format with thousand separators for display
- Payment method: must be selected before confirm

**API call on confirm:**
```ts
const res = await fetch('/api/user/topup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ amount, paymentMethod }),
});
```

**Dialog behavior:**
- Uses a modal overlay (backdrop click closes)
- ESC key closes
- X button in corner closes
- On close at any step → reset state to step 1
- On success → show confirmation step → auto-close after 3s or manual close

**API Implementation (`src/app/api/user/topup/route.ts`):**
```ts
const topUpSchema = z.object({
  amount: z.number().min(10000, "Minimum top up Rp10.000").max(10000000, "Maksimum top up Rp10.000.000"),
  paymentMethod: z.enum(["BCA", "Mandiri", "BNI", "GoPay", "OVO", "Dana"]),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const result = topUpSchema.safeParse(body);
  if (!result.success) return NextResponse.json({ error: "Validasi gagal", fieldErrors: result.error.flatten().fieldErrors }, { status: 400 });

  // Create TopUp record AND increment balance in a transaction
  const [topUp, updatedUser] = await prisma.$transaction([
    prisma.topUp.create({
      data: {
        amount: result.data.amount,
        paymentMethod: result.data.paymentMethod,
        status: "confirmed", // Auto-confirmed for now (no real payment gateway)
        userId: session.user.id,
      },
    }),
    prisma.user.update({
      where: { id: session.user.id },
      data: { donationBalance: { increment: result.data.amount } },
      select: { donationBalance: true },
    }),
  ]);

  return NextResponse.json({ topUp, balance: updatedUser.donationBalance }, { status: 201 });
}
```

**Note:** This replaces the existing `/api/balance/topup` endpoint. The old endpoint should be removed after migration. The new endpoint adds payment method tracking via the TopUp model while maintaining the same direct-credit behavior.

### 6. Verification Dialog

**File:** `src/components/dialogs/VerificationDialog.tsx`

**Component structure:**
```
VerificationDialog (client)
├── Step 1: TypeSelection
│   ├── KTPOption (card with icon)
│   └── OrganizationOption (card with icon)
├── Step 2a: KTPForm
│   ├── FullNameInput (2-100 chars)
│   ├── NIKInput (exactly 16 digits)
│   └── SubmitButton
├── Step 2b: OrganizationForm
│   ├── OrgNameInput (2-100 chars)
│   ├── RegNumberInput (min 5 chars)
│   └── SubmitButton
└── SuccessConfirmation
    ├── SuccessIcon + message
    └── CloseButton
```

**Props interface:**
```ts
interface VerificationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void; // callback to refresh session
}
```

**Validation schemas:**
```ts
const ktpSchema = z.object({
  type: z.literal('ktp'),
  fullName: z.string().min(2, "Nama minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
  nik: z.string().regex(/^\d{16}$/, "NIK harus 16 digit"),
});

const orgSchema = z.object({
  type: z.literal('organization'),
  orgName: z.string().min(2, "Nama organisasi minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
  regNumber: z.string().min(5, "Nomor registrasi minimal 5 karakter"),
});
```

**API Implementation (`src/app/api/user/verify/route.ts`):**
```ts
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  // Validate based on type
  let validData;
  if (body.type === 'ktp') {
    const result = ktpSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "Validasi gagal", fieldErrors: result.error.flatten().fieldErrors }, { status: 400 });
    validData = result.data;
  } else if (body.type === 'organization') {
    const result = orgSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "Validasi gagal", fieldErrors: result.error.flatten().fieldErrors }, { status: 400 });
    validData = result.data;
  } else {
    return NextResponse.json({ error: "Tipe verifikasi tidak valid" }, { status: 400 });
  }

  // Update user: set verified + upgrade role
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      isVerified: true,
      verificationType: validData.type,
      role: 'CAMPAIGN_CREATOR',
    },
    select: { id: true, isVerified: true, verificationType: true, role: true },
  });

  return NextResponse.json({ user }, { status: 200 });
}
```

**Role upgrade logic:**
- On successful verification, the user's role is upgraded from `DONOR` to `CAMPAIGN_CREATOR`
- The JWT callback in `src/lib/auth.ts` already fetches fresh `role` from DB on every token refresh
- After verification success, call `update()` from next-auth to refresh the client session

**Already-verified user behavior:**
- In `src/app/akun/page.tsx`, if `user.isVerified === true`, replace the "Verifikasi" button with a verification status badge showing the verification type (e.g., "✓ Terverifikasi via KTP" or "✓ Terverifikasi via Organisasi")
- The existing conditional `{!user?.isVerified && (...)}` should be changed to always render the card but with different content based on verification status

### 7. Search Category Filtering

**File:** `src/components/search/CategoryFilter.tsx`

**Component design:**
```tsx
'use client';

interface CategoryFilterProps {
  categories: { id: string; name: string; slug: string }[];
  activeSlug: string | null;
  onSelect: (slug: string | null) => void;
}

export function CategoryFilter({ categories, activeSlug, onSelect }: CategoryFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      <button
        onClick={() => onSelect(null)}
        className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
          activeSlug === null
            ? 'bg-primary text-white'
            : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
        }`}
      >
        Semua
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.slug === activeSlug ? null : cat.slug)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            cat.slug === activeSlug
              ? 'bg-primary text-white'
              : 'bg-gray-100 text-text-secondary hover:bg-gray-200'
          }`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
```

**Integration in `src/app/search/page.tsx`:**

1. Fetch categories on mount using `useSWR('/api/categories')`
2. Read `category` from `useSearchParams()`
3. Pass `category` to the existing `useCampaigns({ search: query, category })` hook
4. On category select → update URL: `router.push(\`/search?q=${query}&category=${slug}\`)`
5. The existing `GET /api/campaigns` route already supports `?category=` param

**URL query parameter integration:**
```ts
// In SearchContent component
const category = searchParams.get('category') || undefined;
const { campaigns, total, isLoading } = useCampaigns({ search: query, category });

const handleCategorySelect = (slug: string | null) => {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (slug) params.set('category', slug);
  router.push(`/search?${params.toString()}`);
};
```

**Categories API (`src/app/api/categories/route.ts`):**
```ts
export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, name: true, slug: true, icon: true, order: true },
  });

  const response = NextResponse.json({ categories });
  response.headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return response;
}
```

**Empty state for category filter:**
- When filtered results are 0, show: "Tidak ada kampanye ditemukan dalam kategori ini"
- This is an addition to the existing empty state in the search page

### 8. Footer Component

**File:** `src/components/layout/Footer.tsx`

**Extraction approach:**
1. Copy the existing footer JSX from `src/app/page.tsx` (lines ~220-280)
2. Convert all `<a>` tags to Next.js `<Link>` components
3. Export as a named component

**Component implementation:**
```tsx
import Link from 'next/link';

export function Footer() {
  return (
    <footer className="hidden lg:block bg-bg-secondary border-t border-border mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <h4 className="font-semibold text-text mb-2">Informasi</h4>
            <ul className="space-y-1 text-text-secondary">
              <li><Link href="/about" className="hover:text-primary">Tentang Kami</Link></li>
              <li><Link href="/careers" className="hover:text-primary">Karir</Link></li>
              <li><Link href="/press" className="hover:text-primary">Media</Link></li>
            </ul>
          </div>
          {/* ... Bantuan, Legal, Ikuti Kami columns ... */}
        </div>
        <div className="border-t border-border mt-6 pt-4 text-center text-xs text-text-secondary">
          © 2024 Fund for Indonesia. Semua hak dilindungi undang-undang.
        </div>
      </div>
    </footer>
  );
}
```

**Layout integration strategy (SINGLE APPROACH — ConditionalFooter only):**

The Footer uses `hidden lg:block` to only render on desktop (≥1024px), since mobile uses BottomNavBar.

Add `<ConditionalFooter />` to `src/app/layout.tsx` after `{children}`. This is the ONLY place Footer renders — do NOT add Footer to any other layout to avoid double-rendering.

```tsx
'use client';
import { usePathname } from 'next/navigation';
import { Footer } from '@/components/layout/Footer';

const HIDE_FOOTER_PATTERNS = ['/login', '/register', '/admin', '/moderasi'];

export function ConditionalFooter() {
  const pathname = usePathname();
  const shouldHide = HIDE_FOOTER_PATTERNS.some(p => pathname.startsWith(p));
  if (shouldHide) return null;
  return <Footer />;
}
```

**Cleanup:** Remove the inline footer from `src/app/page.tsx` after extraction.

---

## File Structure

Complete list of new files to create:

```
# Static pages
src/app/(static)/layout.tsx
src/app/(static)/about/page.tsx
src/app/(static)/careers/page.tsx
src/app/(static)/press/page.tsx
src/app/(static)/help/page.tsx
src/app/(static)/faq/page.tsx
src/app/(static)/contact/page.tsx
src/app/(static)/terms/page.tsx
src/app/(static)/privacy/page.tsx

# Account features
src/app/akun/pengaturan/page.tsx
src/app/akun/kampanye-saya/page.tsx

# API routes
src/app/api/user/profile/route.ts
src/app/api/user/avatar/route.ts
src/app/api/user/password/route.ts
src/app/api/user/verify/route.ts
src/app/api/user/topup/route.ts
src/app/api/user/campaigns/route.ts
src/app/api/categories/route.ts
# NOTE: /api/notifications/unread-count already exists — no new file needed

# Components
src/components/layout/Footer.tsx
src/components/layout/ConditionalFooter.tsx
src/components/dialogs/TopUpDialog.tsx
src/components/dialogs/VerificationDialog.tsx
src/components/search/CategoryFilter.tsx

# Hooks
src/lib/hooks/useUnreadCount.ts

# Prisma migration (generated)
prisma/migrations/XXXXXX_add_topup_model/migration.sql
```

**Modified files:**
```
src/app/page.tsx                          — remove inline footer
src/app/akun/page.tsx                     — wire buttons, fix link, show verification status
src/app/search/page.tsx                   — add CategoryFilter
src/app/layout.tsx                        — add ConditionalFooter
src/components/layout/DesktopHeader.tsx   — bell navigates to /inbox (Link wrapper)
src/components/layout/AppShell.tsx        — pass session user to DesktopHeader, use shared useUnreadCount hook
src/app/api/balance/topup/route.ts       — REMOVE (replaced by /api/user/topup)
prisma/schema.prisma                      — add TopUp model + relation on User
```

---

## Error Handling

- All API endpoints return `401 Unauthorized` for unauthenticated requests
- All API endpoints return `400` with Zod field errors for invalid input
- All API endpoints return `500` for unexpected errors (never leak stack traces)
- Avatar upload rejects files > 2MB with `413` style error message in JSON
- Password change returns specific `"Password saat ini salah"` for wrong current password
- Top-up validation returns min/max amount errors inline in the dialog
- Verification NIK validation returns `"NIK harus 16 digit"` inline
- Network failures in client components show toast/error banner with retry option
- Protected pages redirect to `/login` if session is missing

## Correctness Properties

### Property 1: Static Pages Accessibility
All 8 static pages return HTTP 200 and render their heading text without authentication.
**Validates: Requirements 1.9, 1.10**

### Property 2: Profile Name Persistence
Profile name updates persist in database and reflect in the next session refresh.
**Validates: Requirements 2.2, 2.3**

### Property 3: Password Security
Password change with wrong current password always returns 400 and never modifies the stored hash.
**Validates: Requirements 2.7**

### Property 4: Avatar Size Constraint
Avatar upload exceeding 2MB is always rejected before writing to disk.
**Validates: Requirements 2.5**

### Property 5: Verification Role Upgrade
Successful verification submission always upgrades user role from DONOR to CAMPAIGN_CREATOR.
**Validates: Requirements 6.5**

### Property 6: Top-Up Amount Bounds
Top-up amount is always validated to be between 10,000 and 10,000,000 inclusive.
**Validates: Requirements 5.4, 5.5**

### Property 7: Search Filter Intersection
Category filter combined with search query returns the intersection of both filters.
**Validates: Requirements 7.4**

### Property 8: Footer Viewport Restriction
Footer is never rendered on mobile viewports (<1024px) or on auth/admin/moderasi pages.
**Validates: Requirements 8.2, 8.3**

### Property 9: Bell Navigation Consistency
Notification bell click always navigates authenticated users to `/inbox`.
**Validates: Requirements 4.1**

### Property 10: Campaign Link Correctness
"Galang Dana Saya" link on the account page always navigates to `/akun/kampanye-saya`.
**Validates: Requirements 3.5**

---

## Testing Strategy

**Unit / Integration tests:**
- API route tests for all new endpoints (profile, password, avatar, verify, topup, campaigns, categories, unread-count)
- Validate auth guards (401 for unauthenticated, proper role checks)
- Validate input validation (Zod schema edge cases)
- Test TopUpDialog multi-step flow state management
- Test VerificationDialog form validation

**E2E tests (Playwright):**
- Navigate to all 8 static pages → verify 200 status, heading text present
- Settings page: update name, upload avatar, change password (happy + error paths)
- My Campaigns: list pagination, empty state rendering
- Notification bell: click → navigates to /inbox
- Top Up: full flow amount → payment → confirmation
- Verification: KTP flow, organization flow, validation errors
- Search: category filter selection, URL sync, combined with text search
- Footer: visible on desktop, hidden on mobile, all links work

**Key edge cases to test:**
- Password change with wrong current password
- Avatar upload with oversized file / wrong format
- Top Up with amount below minimum / above maximum
- Verification with invalid NIK (not 16 digits)
- Search category filter with 0 results
- Unauthenticated access to protected pages (redirect to /login)
