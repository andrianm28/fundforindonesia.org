---
status: proposed
---

# Two languages through next-intl: Indonesian unprefixed, English under `/en`, pathnames translated, data slugs shared

Status per decision: the library, the two languages, pathnames translated per language and a sitemap listing
every language version are **decided by the owner** (2026-10-04, round C, E7:
`percepatan-full-rilis/keputusan-ronde-c.md`, ticket `fase-3-perluasan/issues/08`). The rest is **Proposed**
and becomes Accepted when the owner approves this PR; where it still waits on an answer it says **[Q1]** to
**[Q7]**, listed at the end.

Nothing is translated today: no i18n library, every string a literal, `<html lang="id">` fixed in the root
layout. PRD FFI-15 and section 3 say the English version keeps the Indonesian slugs (`/wakaf` and `/hibah`
"pada kedua bahasa"); the owner reversed that, so this ADR contradicts those passages on purpose (they need an
amendment note like the PRD's of 2026-10-04; not edited here). It contradicts no ADR. URLs are what is hard to
reverse: an indexed, shared pathname can later change only through a permanent redirect, so the map is fixed
before any text is extracted.

## 1. Library and version

`next-intl` 4.x, target `^4.14.9` (npm `latest` on 2026-10-10), never below 4.9.2: 4.9.1 and older carry
GHSA-4c35-wcg5-mm9h (prototype pollution via `experimental.messages.precompile`), anything below 4.9.1 also
GHSA-8f24-v5vv-gm5j (open redirect, CWE-601), and this ADR leans on the middleware that issues redirects. Fit
with the tree (next 16.3.7, react 19.3.0 per `package-lock.json` at `origin/main` 6c8f0b8): 4.14.9 declares
peers up to `next ^16.0.0` and `react ^19.0.0`; Next 16 enters the peer range at 4.4.0.

Provenance: the API below is read from the 4.14.9 package (typings, middleware source) and Next behaviour from
the docs shipped in `next@16.3.7`. The next-intl docs site was not reachable from the authoring environment, so
none of its prose is quoted; what depends on it says "confirm in the docs".

- Used: `defineRouting` (`next-intl/routing`), `createMiddleware(routing)` (a plain
  `(request) => NextResponse`), `createNavigation(routing)` (`Link`, `redirect`, `permanentRedirect`,
  `getPathname({ href, locale })`, and a client `usePathname` that returns the internal path),
  `createNextIntlPlugin` (`next-intl/plugin`).
- `requestLocale` and `setRequestLocale` are typed `@deprecated` in 4.14.9 in favour of `next/root-params`,
  which Next 16.3.7 documents. New code reads the locale that way; the shape of `src/i18n/request.ts` comes from
  the docs of the installed version (confirm in the docs).
- No `experimental.*` plugin option: that excludes `precompile` (the advisory) and `extract`/`useExtracted`,
  which derives keys from source text where this ADR wants a reviewable catalogue. 4.14.9 also depends on
  `@swc/core` and `@parcel/watcher` (native) for that extractor; only extractor files import them, so they
  should stay out of the standalone image, and the `image` job covers the PR that adds them.

## 2. Locales, prefix and the pathname map

```ts
// src/i18n/routing.ts (options as typed in next-intl@4.14.9)
export const routing = defineRouting({
  locales: ['id', 'en'],
  defaultLocale: 'id',
  localePrefix: 'as-needed',
  localeDetection: false,
  localeCookie: false,
  alternateLinks: false,
  pathnames, // the map below, keyed by the folder paths that exist today
});
```

`as-needed`, not `always`: every existing URL is Indonesian and unprefixed and Campaign links are what people
share; `always` would move them all under `/id`. The middleware redirects `/id/...` to the unprefixed form, so
an Indonesian page has one URL. Detection and cookie are off so the URL alone decides: with detection on, the
middleware reads the cookie, then `Accept-Language` (`resolveLocale.js`), and would send an English-preferring
visitor who opens a shared Indonesian link to `/en/...`. Off, one URL is one language and no cookie is set; a
"view in English" banner can come later. **[Q3]**

| Zone | Routes | Decision |
| --- | --- | --- |
| Back-office | `/admin/**`, `/moderasi/**` | Outside i18n: Indonesian, unprefixed, own root layout, no `/en/admin` page. The language middleware never runs on them (it would rewrite `/admin` to `/id/admin`). FFI-15 names menus and the Campaign and Program pages, not staff panels. |
| Signed-in | `/akun/**`, `/donasi-saya`, `/inbox`, `/campaign/create`, `/volunteer-trip/[slug]/daftar/[batchId]`, `/volunteer-trip/registrasi/[id]` | Inside the localized tree, so the UI is bilingual, but one pathname in both languages (`/en/akun`): behind sign-in, not shared, and each translated name adds gate, robots and email-link entries. |
| Public | the map below | Translated by the rule below. |

`/api/**`, `robots.ts` and `sitemap.ts` are not pages and stay at the app root.

Rule: translate a segment when the Indonesian UI word differs from the English one; keep it when the term is
shared: the CONTEXT.md terms (Campaign, Program, Volunteer Trip, Receipt, Akad Wakaf), Zakat, Hibah and Impact
(PRD section 3 keeps Hibah and "Impact & Transparency" identical in both menus) and the loanwords login,
register, reset-password. So the most shared URL, `/campaign/<slug>`, does not change. The `pathnames` keys are
today's folder paths: nothing under `src/app` renames and `href="/about"` literals stay valid input for the
library's `Link`. Query parameters are not translated.

| Internal path (folder) | Indonesian, no prefix | English, after `/en` |
| --- | --- | --- |
| `/` | `/` | `/` |
| `/explore/all` | `/jelajah/semua` | `/explore/all` |
| `/explore/[category]` | `/jelajah/[category]` | `/explore/[category]` |
| `/campaign/[slug]` | same | same |
| `/campaign/[slug]/donate` | `/campaign/[slug]/donasi` | `/campaign/[slug]/donate` |
| `/program`, `/program/[slug]` | same | same |
| `/zakat`, `/volunteer-trip`, `/volunteer-trip/[slug]`, `/impact`, `/faq` | same | same |
| `/search` | `/cari` | `/search` |
| `/about` | `/tentang-kami` | `/about` |
| `/careers` | `/karir` | `/careers` |
| `/press` | `/media` | `/press` |
| `/help` | `/bantuan` | `/help` |
| `/contact` | `/kontak` | `/contact` |
| `/terms` | `/syarat-dan-ketentuan` | `/terms` |
| `/privacy` | `/kebijakan-privasi` | `/privacy` |
| `/login`, `/register`, `/reset-password` | same | same |
| `/lupa-password` | `/lupa-password` | `/forgot-password` |
| `/receipt/[token]`, `/akad-wakaf/[token]` | same | same |
| `/sertifikat/[code]` | `/sertifikat/[code]` | `/certificate/[code]` |
| reserved, page not built: `/wakaf`, `/hibah` | `/wakaf`, `/hibah` | `/waqf`, `/hibah` **[Q7]** |

"same" is identical in both languages (English still gets `/en`). Eleven rows change today's Indonesian URL: both
explore rows, donate, search, about, careers, press, help, contact, terms, privacy. **[Q1]**

## 3. Slugs that come from data

| Entity | Slug today | Decision |
| --- | --- | --- |
| Campaign, Volunteer Trip | slugified title plus a random suffix, set at creation (`generateSlug` in the create routes) | One slug in both languages |
| Program | slugified Admin-entered title, Admin-editable (`src/lib/programs.ts`) | One slug in both languages |
| Category | eight seeded rows, slug is the hyphenated Indonesian name (`prisma/seed.ts`) | Translated from a closed table in code; the Indonesian slug stays the database key; no table entry means the canonical slug in every language |

Campaign, Trip and Program slugs stay shared: the text a slug could come from exists in one language only; a
Campaign or Trip slug is a random-suffixed identifier, not a keyword; translating needs a slug column and
uniqueness per language plus a lookup before every page; and a Campaign link shared in a chat must open the
same Campaign in either language. Revisit when an entity gets per-language text. Category differs: a closed
vocabulary whose English names are in the messages anyway, and `/explore/<category>` is a landing page where an
English keyword has search value.

Redirects:

- The eleven renamed Indonesian URLs: `permanent: true` in `next.config.mjs` `redirects()`, static before
  dynamic. They run before the proxy (Next docs, "Execution order") and answer 308, which clients may cache for
  ever (Next docs), so they ship once the map is final, and a later rename sends every earlier spelling
  straight to the newest.
- Any other path in the other language's spelling (`/certificate/<code>` without `/en`, `/en/tentang-kami`): the
  middleware redirects to the visitor's form with `NextResponse.redirect(url)`, which Next defaults to 307
  (`middleware.js`). Fine: nobody has published those URLs.
- A Category slug in the wrong language: `permanentRedirect` from the page.

## 4. Canonical, hreflang and sitemap

- Canonical: each localized page names itself, its absolute URL in its own language (`publicUrl()` plus
  `getPathname({ href, locale })`), query string dropped as the Campaign page does today. **[Q2]**
- hreflang: `id`, `en` and `x-default` (the Indonesian URL); bare language codes, one version per language.
  Next's `Languages` type accepts all three, in `generateMetadata` and in the sitemap.
- One helper returns `{ canonical, languages }` and every `generateMetadata` calls it. Metadata exports are
  Server Component only (Next docs) and `explore/all`, `search`, `zakat`, `login`, `register` and the donate
  page are client components today, so they take it from a server `layout.tsx`.
- next-intl's `Link` response header stays off. It is on by default and does add `x-default`
  (`routing/config.js`, `getAlternateLinksHeaderValue.js`), but it derives alternates from the path map alone for
  every path, cannot ask whether the other version exists or is indexable, and would also announce token pages.
- Sitemap: each URL listed today (home, explore, zakat, login, register, categories, Campaigns) becomes one
  `<url>` per language, each carrying the full alternate set, itself included (Google's localized-versions
  guidance, linked from next-intl's typings; not re-read here); Next 16.3.7 renders `alternates.languages` as
  `<xhtml:link rel="alternate" hreflang>`. Pages the sitemap lacks today stay out. Next's docs quote 50,000
  URLs per sitemap; doubling the entries brings `generateSitemaps` nearer, at about 25,000 Campaigns.
- Token pages (Receipt, Akad Wakaf, Sertifikat) and signed-in pages carry no alternates.

## 5. Messages and formats

- `src/messages/id.json` and `en.json`, same key tree (inside `src/`, next to the code that imports them). One
  PascalCase namespace per feature, named for the folder that owns the screen (`Home`, `Campaign`, `Donation`,
  `Receipt`, `Zakat`, `Program`, `VolunteerTrip`, `Auth`, `Account`...), plus `Common`, `Nav`, `Metadata` (per
  internal path), `Enums` (labels now in `KIND_LABEL`, `SECTOR_LABEL`, `campaign-status-label.ts`) and `Errors`
  (by API `code`).
- camelCase keys named for their role (`donateButton`); ICU for plurals and selects; no concatenation, no HTML
  in a message (rich-text tags), a dynamic key only from a closed enum. Explicit keys, not `useExtracted`.
- Typed through an `AppConfig` augmentation (`use-intl`), so a wrong key is a tsc error, which the ratchet
  counts. A test requires the same keys and ICU arguments in both files; a missing English key fails CI, with
  no runtime fallback to Indonesian.
- The UI renders `Errors.<code>`, never the Indonesian `error` text of a response (money routes already answer
  `{ error, code }`, `.scratch/deploy-readiness.md`; a route without a `code` gets one when its screen is
  converted). Indonesian keeps the CONTEXT.md terms; English follows PRD section 3 (Wakaf and Waqf, Hibah in
  both). Legal and religious texts need a human translator. **[Q5]**

**New screens.** From the day this ADR is accepted, every new screen or component with visible text uses keys, in
the same PR. The plumbing must exist first, while the full conversion (route move, English messages, map,
proxy) is the E7 ticket, done alone late in the plan. So a first slice changes no URL: the dependency
(`package.json` is coordinator-only, ticket 08), the plugin, `src/i18n/request.ts` returning `locale: 'id'`,
`src/messages/id.json` and a provider in the root layout (confirm in the docs: next-intl without i18n
routing). Screens before E7 use `useTranslations`/`getTranslations` and keep `next/link`; E7 swaps the imports
and adds `en.json` and the parity test.

Formats, set once in `src/i18n/request.ts` through global `formats` and `timeZone` (both `IntlConfig` fields):

- Rupiah: whole rupiah (`Int` in the schema; PRD section 9), IDR only. `formatRupiah(amount, locale)` stays the
  one entry point with today's shape (minus, `Rp`, digits, no space): `Rp25.841.000` and `Rp25,841,000`; only the
  grouping follows the language. Not `Intl`'s currency style, which prints `Rp 25.841.000` for `id`
  (U+00A0) and `IDR 25,841,000` for `en` and would change every Indonesian money string and test.
- Dates: named formats that reproduce today's Indonesian output (`06 Jun 2026`); English follows ICU
  (`Jun 06, 2026`). `formatIndonesianDate`, the `Intl.DateTimeFormat('id-ID')` and `toLocaleString` calls and
  `getRelativeTimestamp` move to the formatter.
- Time zone set once, since without one "the user time zone will be used" (typings): the server container's or
  each browser's. Proposed `Asia/Jakarta` for moments; calendar dates keep `UTC`, as the Program page does.
- Tags are `id` and `en`; `id` and `id-ID` format identically (checked below). The approximate foreign-currency
  display in FFI-15 is not part of this. **[Q6]**

## Considered options

- Another library, or hand-rolled dictionaries as in Next's own i18n guide: not weighed, the owner chose
  `next-intl`.
- Indonesian slugs for both languages (PRD FFI-15, and the recommendation put to the owner): rejected by the
  owner. Translating data slugs too: rejected for Campaign, Trip and Program, kept for Category.
- `localePrefix: 'always'` (moves every existing URL); `'never'` with a cookie (one URL for both languages,
  nothing to pair, which defeats E7); a domain per language (certificate, DNS and proxy work for no gain).
- next-intl's `Link` alternates header instead of head tags, and `Intl`'s currency style for Rupiah (sections 4, 5).

## Consequences

- `src/proxy.ts` becomes the one place that composes the sign-in gate and the language middleware: Next allows
  one proxy function per file and a static-literal `config.matcher` (`proxy.md`), so the matcher is broad and
  the function dispatches on the path. Back-office, `/api` and files never reach the language middleware; gated
  localized paths pass `withAuth` first and then the middleware (a plain function, so it can be `withAuth`'s
  inner one); other localized paths get the middleware only. The proxy now runs on every page request, not only
  private ones.
- The gate must fail closed in every language. Today's matcher lists `/akun`, `/donasi-saya`, `/inbox` and
  `/campaign/create` literally, and `/en/akun` matches none. The dispatch decides on the path with any locale
  prefix stripped (case-insensitive, `/id/...` included); the matcher lists each gated path with and without
  `/en` and keeps the `/akun/verifikasi-email` exclusion, so its token never lands in a `callbackUrl`. A test
  derives every gated path from the map and asserts it is gated in both languages; `src/proxy.test.ts` changes
  with the composition.
- `headers()` in `next.config.mjs` sends `Referrer-Policy: no-referrer` on `/akun/verifikasi-email` and
  `/reset-password` (`src/next-config.test.ts`); each needs the same rule under `/en`. `robots.ts` has a
  hand-written prefix list (`PRIVATE_PATHS`) that must be generated from the map per language (`/en/akun`,
  `/en/receipt/`, `/en/certificate/`), or English copies of private pages become crawlable. So the map is plain
  data that `next.config.mjs` can import (no `@/` alias there).
- `[locale]/layout.tsx` becomes the root layout of the localized tree (fonts, providers, `AppShell`, beta banner,
  `<html lang={locale}>`; an unknown segment is a 404); back-office gets its own with `lang="id"`. Rendering does
  not change: the root layout already calls `connection()` (ticket `rilis-1-benda/92`,
  `src/lib/beta-sandbox-request.ts`), so every route renders per request, and next-intl's server APIs opt into
  dynamic rendering when they read the locale (`RequestLocale.js`). `generateStaticParams` and `setRequestLocale`
  are not used. No cookie or header picks the language, so one URL is one language for any cache in front.
- `href` literals stay (they are the keys); imports change from `next/link` and `next/navigation` to
  `src/i18n/navigation.ts`, and components that test the path (`AppShell`, `ConditionalFooter`) use the
  library's `usePathname`. A `no-restricted-imports` rule comes only after conversion, so the lint ratchet does
  not rise. The language switcher is a plain link per language to the same internal path and params (`Link`
  takes a `locale` prop): no cookie, and a Category slug goes through the table.
- `pages.signIn` in `src/lib/auth.ts` is a single string and several pages build `/login?callbackUrl=...` by
  hand: a sign-in redirect must carry the visitor's language. `publicUrl(path)` (emails, `ShareModal`, sitemap)
  and the relative path stored in `Notification.link` gain a locale-aware sibling on `getPathname`. **[Q4]**
- Tests. Unit: the map matches the pages under `src/app/[locale]` (no two keys with one path per language, equal
  param names); gate coverage; message parity; the alternates helper; the Category table; `headers()`,
  `redirects()` and `robots.ts` cover every variant. e2e: existing specs follow the Indonesian spelling
  (`/search?q=` becomes `/cari?q=`, the donate path `/donasi`); English gets one Playwright project, not three
  viewports: `/en` with `lang="en"` and `x-default`, the switcher keeping page and Category slug, `/about`
  answering 308 to `/tentang-kami`, `/en/admin` serving no panel with `/admin` still gated, a sitemap with
  both versions.
- Outside the repo: the reverse proxy must pass `/en/...` through unchanged (the owner confirms no rule there
  assumes today's paths). CONTEXT.md needs no new term.

## Open questions

Each says what the proposal assumes meanwhile.

- **Q1. Renaming eleven Indonesian URLs during the beta.** Assumed: rename, with 308s, since the beta has little
  link equity yet and a rename only gets dearer. If not, those rows keep today's Indonesian spelling and nothing
  else here changes.
- **Q2. English pages whose body a user wrote** (Campaign, Volunteer Trip, Program detail): English chrome around
  text in the author's language. Assumed, following E7's wording: both versions paired and in the sitemap.
  Alternative: the English URL canonicalises to the Indonesian one and stays out of the sitemap until the entity
  has English text. Also open: whether FFI-15 ("halaman Campaign serta Program tersedia dalam dua bahasa")
  means translated content, which needs per-language fields in the schema.
- **Q3. Language detection.** Assumed off. Alternative: on (cookie, then `Accept-Language`), so a shared
  Indonesian link redirects some visitors to `/en`.
- **Q4. Language outside the browser:** emails, notifications (a `Notification` row stores its finished
  Indonesian `title` and `message`) and the Receipt and Akad Wakaf links in emails. Assumed: Indonesian emails and
  notifications, token pages in the language of their URL, link builders taking a locale argument. English for
  English donors needs a stored `locale` on User or Donation (schema).
- **Q5. Legal and religious texts** (Terms, Privacy, Akad Wakaf, ikrar, zakat guidance): who translates, which
  language prevails. Assumed: no machine translation in the extraction ticket, and the English page says the
  Indonesian text prevails until the owner and counsel decide.
- **Q6. The approximate foreign-currency display in FFI-15:** needs a rate source, refresh rule and disclaimer.
  Assumed: not built in E7.
- **Q7. `/wakaf` and `/hibah` landing pages** (PRD section 3, not built). Assumed `/wakaf` with `/waqf`, and
  `/hibah` in both.

Not decided here: the English wording of any screen (the extraction ticket) and a third language (one more
`locales` entry, map column, messages file and prefix).

## Checked with

At `origin/main` 6c8f0b8; registry and docs as of 2026-10-10.

- `npm view next-intl@4.14.9 peerDependencies dependencies --json`; `npm view next-intl@4.3.12
  peerDependencies.next` (no `^16`) against `@4.4.0` (has it).
- `curl -s -X POST -H 'content-type: application/json' --data '{"next-intl":["4.9.1"]}'
  https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` returns GHSA-4c35-wcg5-mm9h; `["4.3.0"]` returns
  both advisories; `["4.9.2"]` and `["4.14.9"]` return `{}`.
- `npm pack next-intl@4.14.9`, then read `dist/types/routing/config.d.ts`, `dist/types/server/react-server/
  getRequestConfig.d.ts` and, under `dist/esm/development`, `middleware/*.js` and
  `server/react-server/RequestLocale.js`; `grep -rl '@swc/core' dist/esm/production` lists only extractor files.
- Under `node_modules/next/dist/docs/01-app/03-api-reference`: `03-file-conventions/proxy.md`,
  `03-file-conventions/01-metadata/sitemap.md`, `04-functions/generate-metadata.md`,
  `05-config/01-next-config-js/redirects.md`; the `NextResponse.redirect` default status is in
  `node_modules/next/dist/server/web/spec-extension/response.js`.
- ICU, Node 24.21 (ICU 78.3): `node -e "for(const l of ['id','en'])console.log(l,new Intl.DateTimeFormat(l,{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date('2026-06-06')),new Intl.NumberFormat(l,{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(25841000))"`
  prints `06 Jun 2026` with `Rp 25.841.000` for `id`, and `Jun 06, 2026` with `IDR 25,841,000` for `en`; the
  same with `Intl.NumberFormat(l)` gives `25.841.000` and `25,841,000`, and `id-ID` prints what `id` does.
