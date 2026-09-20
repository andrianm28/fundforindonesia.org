---
status: accepted
---

# Keep the Next.js, Prisma, and Postgres stack

The PRD dated 18 September 2026 lists SvelteKit, ElysiaJS on Bun, and Drizzle as the stack, describing it as "the direction of the fundraising platform already in progress". That platform is this repository, and it is built on Next.js 14, Prisma, next-auth, and Postgres, with a reviewed double-entry ledger, escrow, and payout layer already in place. We keep this stack and treat the PRD's stack row as an error to be corrected, because rewriting the money layer to change frameworks would discard the most reviewed code in the project for no product gain.

## Considered options

- Rebuild on SvelteKit, ElysiaJS, Drizzle as the PRD says. Rejected: months of work, and every money invariant would need re-proving.
- Keep Next.js and Prisma. Accepted.
