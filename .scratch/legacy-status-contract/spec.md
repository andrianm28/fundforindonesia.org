# Spec: Retire the legacy Campaign status string

Status: ready-for-agent
Source: architecture review of 2026-09-26, candidate 3, and the grilling that followed. This completes the expand–contract that prd-compliance tickets 02–05 started. `CONTEXT.md` (Campaign Status).

## Problem Statement

Campaigns carry two status columns: the `lifecycleStatus` enum, which every rule now reads, and the legacy `status` string (`pending`, `active`, `rejected`, `suspended`, `cancelled`, `completed`, `expired`).
- **Writers:** three places still write the string: the lifecycle `transition()`, Campaign creation and the seed.
- **Readers:** seven places still read it:
  - the Verifier queue and moderation pages (`status: "pending"`, `isPending`);
  - the Admin Campaign list;
  - `GET /api/user/campaigns` and the "Kampanye Saya" page;
  - the `GET /api/campaigns/[slug]` payload;
  - the Campaign page.
- **Other damage:** the mapper throws for DRAFT, which blocks the Draft flow Verification Request needs. The client type `CampaignStatus` lists 3 of the 7 values and shares its name with the Prisma enum. Every test row seeds both columns, and a dual-write guard exists only to keep the two in step.

## Solution

Three steps:
1. The seven readers move to the enum. Badges use the effective status and the one Indonesian label map, and payloads drop `status`.
2. Nothing writes the string any more. The mapper, the dual-write and its guard are deleted, and the column becomes nullable and ignored.
3. A migration drops the column. It deploys separately, after step 2 is live in production, so rolling back code stays safe.

DRAFT becomes writable, but no Draft behaviour is added (that is ticket 12).

## User Stories

1. As a Verifier, I want my queue to show exactly the Campaigns awaiting me (SUBMITTED), so that nothing is missed or duplicated.
2. As an Admin, I want every Campaign's badge to show its effective status in Indonesian, so that an Active Campaign past its deadline reads as ended.
3. As a Fundraiser on "Kampanye Saya", I want the same badges, so that my view matches the public page.
4. As an API client, I want one status field (`lifecycleStatus`), so that I don't have to reconcile two.
5. As an engineer, I want one status column, so that tests seed one field and no guard is needed to keep two in step.
6. As an engineer building Verification Request, I want DRAFT to be writable, so that the Draft flow isn't blocked by a mapper.
7. As an operator, I want the column dropped only after the code that stopped using it is live, so that a rollback cannot break.

## Implementation Decisions

- **Step 1 (readers):**
  - The moderation queue and count filter on `lifecycleStatus = SUBMITTED`, and the moderation actions decide "pending" from the enum.
  - The Admin list, "Kampanye Saya" and the Campaign page render badges from `effectiveStatus` with `STATUS_LABEL`.
  - `GET /api/user/campaigns` and `GET /api/campaigns/[slug]` stop selecting and emitting `status`, and send `lifecycleStatus` (effective) instead.
  - The client type `CampaignStatus` in `types/campaign.ts` is removed. Browser code uses a union derived from the Prisma enum.
- **Step 2 (writers):**
  - `transition()`, Campaign creation and the seed stop writing `status`.
  - `toLifecycleStatus`/`toLegacyStatus` are deleted, along with their tests.
  - The dual-write guard is retired and replaced by a guard that nothing reads or writes `status`.
  - The schema marks `status` optional with no default, through an additive migration that drops the default and allows null.
  - The in-memory stand-in's row type loses `status`.
- **Step 3 (drop):** a migration removes the column and its index. It is a human-coordinated deploy: step 2 must be live first.
- **Unchanged:** DRAFT gets no new behaviour, and new Campaigns are still created SUBMITTED.

## Testing Decisions

- **Good tests** assert what screens and payloads show for a given Campaign, not which column was read.
- **Step 1:**
  - The moderation queue lists SUBMITTED only.
  - Badges for every status, including an Active Campaign past its deadline.
  - Payloads carry `lifecycleStatus` and no `status`.
  - A static test pins that no `src` file outside the lifecycle module and migrations names the `status` column for Campaigns.
- **Step 2:** the new guard; the full suite without `status` in any seed row; the migration applied to a fresh Postgres (as done on 25 September) with `migrate diff` empty.
- **Step 3:** the migration applied to a Postgres restored from a step-2 state, and `migrate diff` empty.

## Out of Scope

- The Draft flow and Verification Request (ticket 12).
- VolunteerTrip or Registration status columns, which are enums already.

## Further Notes

Order: 01 → 02 → 03. Ticket 01 also waits for capacity-judgement ticket 03 (running), which edits the same `campaigns/[slug]` route. Ticket 03 is ready-for-human because it needs a production deploy in between.
