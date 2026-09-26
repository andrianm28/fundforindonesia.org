# Plan: fastest path to a correct production

Status: ready-for-agent
Source: the roadmap page "Roadmap FFI — status 26 September 2026", and the grilling of 2026-09-26 (Q1–Q7). The tickets live in their own specs; this plan only orders them.

## Decisions (Q1–Q7)
- **Cutover** happens right after CD 05–07, before Phase 0 is complete. Later work ships through the same CD.
- **At most three agents at a time**, one per lane (the shared host's load).
- **Refresh stale tickets.** Each old prd-compliance ticket is refreshed against today's architecture before it runs: lifecycle runner, Capacity judgement, Verification Request, subject guard, domain errors, CI flow. Tickets 10 and 11 get a grilling first.
- **Mailer:** a Mailer seam with a mock now. The real provider is the **Sumopod SMTP relay**, which the domain is already authenticated for (Stalwart on the host is inbound only).
- **Encryption:** field encryption expand (15) lands before 18, so a Donor's email is never stored in plaintext.
- **Ticket 18** runs after the cutover and needs Sumopod payment credentials in the production `.env` (human ticket 01 here).
- **prd-compliance statuses** have been tidied (02–05 done, 12 annotated).

## Lanes
| Lane | Order | Notes |
| --- | --- | --- |
| A: CD | ci-cd 05 → 06 → 07 → 08 (human cutover) | Deploy by manual dispatch; stay on GitHub Free |
| B: Phase 0 domain | prd 09 Kind → grilling (Partner Organisation, Collecting Entity, Permit, Kind Authorisation) → 10 → 11 | 09 has no blockers |
| C: foundations | prd 13 Mailer → 15 encryption expand → 17 Platform Fee (needs 09) | 13 has no blockers now |
| Then | prd 18 Sumopod QRIS end to end (needs 10, 15, 17, cutover, human 01) → 21 Receipt (needs 13, 18; SMTP creds in production) | |

## Phase gates this reaches
- **Phase 0:** after 09, 10, 11 and 13 are deployed.
- **Phase 1:** after 18 and 21, with a real QRIS donation and a Receipt received.
