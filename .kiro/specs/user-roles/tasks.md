# Implementation Plan: User Roles (RBAC)

## Overview

This plan implements a hierarchical Role-Based Access Control system for the Kitabisa clone platform. The implementation proceeds in layers: schema → utilities → auth integration → middleware → API protection → admin/moderation UI → tests. Each step builds on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Schema changes and migration
  - [x] 1.1 Add Role enum and role field to Prisma schema
    - Add `Role` enum with values: ADMIN, MODERATOR, CAMPAIGN_CREATOR, DONOR
    - Add `role Role @default(DONOR)` field to the User model
    - Run `npx prisma migrate dev --name add_user_roles` to generate migration
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Add post-migration script to upgrade existing verified users
    - Create a migration SQL step or a separate script that runs: `UPDATE "User" SET "role" = 'CAMPAIGN_CREATOR' WHERE "isVerified" = true`
    - Ensure unverified users remain as DONOR
    - _Requirements: 10.1, 10.2_

- [x] 2. Role utility module
  - [x] 2.1 Create `src/lib/roles.ts` with role hierarchy utilities
    - Implement `ROLE_LEVELS` constant mapping each Role to a numeric level (DONOR=0, CAMPAIGN_CREATOR=1, MODERATOR=2, ADMIN=3)
    - Implement `hasRole(userRole, requiredRole)` — exact match check
    - Implement `isAtLeast(userRole, minimumRole)` — hierarchy comparison
    - Implement `requireRole(userRole, minimumRole)` — throws on insufficient role
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 2.2 Write property tests for role hierarchy (Properties 1, 9, 11)
    - **Property 1: Role Hierarchy Correctness** — For all role pairs, `isAtLeast(A, B)` equals `ROLE_LEVELS[A] >= ROLE_LEVELS[B]`
    - **Property 9: Graceful Degradation** — For null/undefined/missing role, system defaults to DONOR-level access
    - **Property 11: Role Invariant** — Role field always contains exactly one value from the valid set
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 2.4, 1.1, 1.3**

- [x] 3. NextAuth session and JWT updates
  - [x] 3.1 Update type augmentation for next-auth
    - Create/update `src/types/next-auth.d.ts` to add `role: Role` to Session.user and JWT interfaces
    - Import Role from `@prisma/client`
    - _Requirements: 2.1, 2.3_

  - [x] 3.2 Update JWT and session callbacks in `src/lib/auth.ts`
    - Add `role: true` to the `select` clause in the JWT callback's DB query
    - Set `token.role = dbUser.role` in the JWT callback
    - Set `session.user.role = (token.role as Role) ?? "DONOR"` in the session callback
    - Handle missing role gracefully by defaulting to DONOR
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Checkpoint - Ensure schema and auth compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Middleware enhancement for role-based route protection
  - [x] 5.1 Update `src/middleware.ts` with role-based route matching
    - Define `ROLE_ROUTES` array mapping route patterns to minimum roles (`/admin` → ADMIN, `/moderasi` → MODERATOR, `/campaign/create` → CAMPAIGN_CREATOR)
    - Add `ROLE_LEVELS` map for numeric comparison inside middleware
    - Read `token.role` from `req.nextauth.token`, default to DONOR if missing
    - Check each ROLE_ROUTES entry against current pathname; redirect to "/" if insufficient
    - Add special case: DONOR on `/campaign/create` redirects to `/akun/verifikasi`
    - Update `config.matcher` to include `/admin/:path*` and `/moderasi/:path*`
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 5.2, 5.3, 6.5_

  - [x] 5.2 Write property tests for middleware route access (Properties 3, 4)
    - **Property 3: Admin Route Access Control** — Only ADMIN role grants access to "/admin" routes
    - **Property 4: Moderation Route Access Control** — Only MODERATOR or ADMIN grants access to "/moderasi" routes
    - **Validates: Requirements 3.1, 3.2, 4.1, 4.2, 6.5**

- [x] 6. API route protection HOF
  - [x] 6.1 Create `src/lib/withRoleCheck.ts` higher-order function
    - Accept `minimumRole: Role` and a route handler function
    - Get session via `getServerSession()`
    - Return 401 if no session, 403 if role insufficient (using `isAtLeast`)
    - Return 500 on unexpected errors (never leak 403 on system errors)
    - Pass through to handler if authorized
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [x] 6.2 Write property tests for API role enforcement (Properties 5, 6)
    - **Property 5: API Role Enforcement** — For any protected endpoint, users below minimum role get 403; users at or above get through
    - **Property 6: Role Assignment Restricted to Admin** — Non-ADMIN users always get 403 on role assignment API
    - **Validates: Requirements 8.1, 8.2, 4.5, 9.3**

- [x] 7. Role management and admin APIs
  - [x] 7.1 Create `src/app/api/admin/users/[id]/role/route.ts`
    - Wrap handler with `withRoleCheck("ADMIN", ...)`
    - Validate request body `role` is one of the valid Role enum values
    - Prevent self-demotion: if `session.user.id === params.id` and role !== "ADMIN", return 400
    - Update user role in database via `prisma.user.update`
    - Create notification for affected user about role change
    - Return updated user object
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 7.2 Create `GET /api/admin/users` endpoint for user listing
    - Wrap with `withRoleCheck("ADMIN", ...)`
    - Support pagination (page, limit) and optional search by name/email
    - Return users with: id, name, email, role, isVerified, createdAt
    - _Requirements: 3.5_

  - [x] 7.3 Create `PATCH /api/moderasi/campaigns/[id]` endpoint for campaign moderation
    - Wrap with `withRoleCheck("MODERATOR", ...)`
    - Accept body: `{ action: "approve" | "reject" | "suspend" }`
    - Update campaign status accordingly (approve → "active", reject → "rejected", suspend → "suspended")
    - Create notification for campaign creator about the action
    - _Requirements: 4.3_

  - [x] 7.4 Write property tests for role management (Properties 7, 8)
    - **Property 7: Role Assignment Validation** — Invalid role strings are rejected; valid ones persist
    - **Property 8: Self-Demotion Prevention** — Admin cannot change own role to non-ADMIN
    - **Validates: Requirements 9.1, 9.2, 9.5**

- [x] 8. Checkpoint - Ensure core RBAC logic works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Admin dashboard pages
  - [x] 9.1 Create admin layout and dashboard overview
    - Create `src/app/admin/layout.tsx` with sidebar navigation (Users, Campaigns, Settings)
    - Create `src/app/admin/page.tsx` with platform stats overview (total users, campaigns, donations)
    - Use server component with `getServerSession()` to verify ADMIN role
    - _Requirements: 3.1, 3.5_

  - [x] 9.2 Create admin users list page
    - Create `src/app/admin/users/page.tsx` with paginated user list table
    - Display user name, email, role badge, verification status, created date
    - Add role change dropdown per user row (calls PATCH `/api/admin/users/[id]/role`)
    - _Requirements: 3.3, 3.5, 9.1_

  - [x] 9.3 Create admin campaigns management page
    - Create `src/app/admin/campaigns/page.tsx` with all campaigns list
    - Include actions: view, edit, delete any campaign
    - _Requirements: 3.4_

- [x] 10. Moderation panel pages
  - [x] 10.1 Create moderation layout and overview
    - Create `src/app/moderasi/layout.tsx` with sidebar navigation (Campaigns, Reports)
    - Create `src/app/moderasi/page.tsx` with pending items overview
    - Use server component with `getServerSession()` to verify MODERATOR+ role
    - _Requirements: 4.1, 4.2_

  - [x] 10.2 Create campaign review page
    - Create `src/app/moderasi/campaigns/page.tsx` listing campaigns pending review
    - Create `src/app/moderasi/campaigns/[id]/page.tsx` with approve/reject/suspend actions
    - Calls `PATCH /api/moderasi/campaigns/[id]` (created in task 7.3)
    - _Requirements: 4.3_

  - [x] 10.3 Create reports management page (stub)
    - Create `src/app/moderasi/reports/page.tsx` with placeholder "Reports coming soon" message
    - Note: Full reports feature requires a Report model (out of scope for this feature — will be a separate spec)
    - _Requirements: 4.4_

- [x] 11. Update existing endpoints with role checks
  - [x] 11.1 Protect campaign creation endpoint with CAMPAIGN_CREATOR role check
    - Add `withRoleCheck("CAMPAIGN_CREATOR", ...)` to `POST /api/campaigns`
    - Remove the old `isVerified` check (now redundant — role handles this)
    - _Requirements: 5.4, 10.4_

  - [x] 11.2 Protect campaign edit/delete endpoints with ownership + role checks
    - Update campaign edit/delete API routes to check: user is ADMIN OR (user is CAMPAIGN_CREATOR AND user is campaign owner)
    - Return 403 if neither condition is met
    - _Requirements: 5.5, 10.4_

  - [x] 11.3 Write property test for campaign ownership enforcement (Property 12)
    - **Property 12: Campaign Creator Ownership Enforcement** — Non-owner CAMPAIGN_CREATOR denied edit/delete; owner allowed; ADMIN always allowed
    - **Validates: Requirements 5.5, 10.4**

- [x] 12. Seed script and default role assignment
  - [x] 12.1 Update seed script to include admin and moderator users
    - Add an ADMIN user (e.g., admin@kitabisa.com) and a MODERATOR user (e.g., moderator@kitabisa.com) to `prisma/seed.ts`
    - Ensure existing seed users get appropriate roles based on their verification status
    - _Requirements: 1.2, 10.1, 10.2_

  - [x] 12.2 Write property test for default role assignment (Property 2)
    - **Property 2: Default Role Assignment** — Any new user registration results in DONOR role
    - **Validates: Requirements 1.2**

- [x] 13. Integration tests
  - [x] 13.1 Write integration tests for role management flow
    - Test admin changes user role → user's next session reflects new role
    - Test notification is created on role change
    - Test non-admin cannot change roles (403 response)
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 13.2 Write integration tests for route protection
    - Test DONOR cannot access /admin or /moderasi routes
    - Test MODERATOR can access /moderasi but not /admin
    - Test ADMIN can access both /admin and /moderasi
    - Test DONOR on /campaign/create redirects to verification page
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 5.2, 5.3_

  - [x] 13.3 Write property test for migration correctness (Property 10)
    - **Property 10: Migration Correctness** — Verified users get CAMPAIGN_CREATOR; unverified get DONOR
    - **Validates: Requirements 10.1, 10.2**

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using `fast-check` (already installed)
- Unit tests validate specific examples and edge cases
- The project uses Vitest for testing and fast-check for property-based tests
- All property tests should use minimum 100 iterations as specified in the design document
- TypeScript is used throughout — all code examples and implementations should be in TypeScript

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["5.1", "6.1"] },
    { "id": 5, "tasks": ["5.2", "6.2", "7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["7.4", "9.1", "10.1", "12.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "10.2", "10.3", "11.1", "11.2"] },
    { "id": 8, "tasks": ["11.3", "12.2", "13.1", "13.2", "13.3"] }
  ]
}
```
