# 01: Campaigns start as Drafts; submitting creates a Verification Request

**What to build:**
- An additive migration adds `VerificationRequest`, `IdentityVerification` and `VerificationChecklistItem`, with the items seeded from PRD §7.1's "all Kinds" row.
- `POST /api/campaigns` creates a DRAFT. The create page offers "Simpan Draft" and "Ajukan ke Verifier".
- A new `submitCampaign` lifecycle command (FUNDRAISER; DRAFT or REJECTED to SUBMITTED) creates a PENDING Verification Request with a checklist snapshot and logs the transition.
- The Verifier queue and count read PENDING Verification Requests.
- Drafts appear nowhere public.

See `.scratch/verification-request/spec.md`.

**Blocked by:** retire-role-hierarchy 02 (same create route)

**Status:** done

- [ ] A new Campaign is DRAFT; submitting moves it to SUBMITTED and creates one PENDING request with the active checklist items snapshotted
- [ ] Submitting from anything but DRAFT or REJECTED is refused with 409; a non-owner gets 403 `NOT_AUTHORIZED`
- [ ] The queue lists PENDING requests only, and Drafts are absent from every public list (a listing test)
- [ ] The migration is verified on a throwaway Postgres, with `migrate diff` empty. Full suite green, tsc adds no errors
