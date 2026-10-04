# 18: Which second payment provider carries VA, e-wallet and disbursement?

**Type:** research

**Status:** resolved

**Built by:** [85: M-c xendit-adapter](85-xendit-adapter.md)

**Findings:** `.scratch/rilis-1-benda/research/18-second-provider.md`

**Blocked by:** —

## Question

Owner decision 2026-09-28: Rilis 1 includes the gates of PRD §11 Fase 0–3
(`CONTEXT.md`, **Rilis 1**). The Fase 2 gate requires *Payments from two
providers reconciled*, and FFI-18 asks for a second provider carrying virtual
accounts, e-wallets and disbursement. Neither the PRD nor any ADR names one.

For the Indonesian candidates (at least Xendit, Midtrans, DOKU, Flip for
Business), compare from primary sources: VA banks and e-wallets supported;
disbursement API and its cost; fees per method; settlement timing and whether
the webhook payload carries the fee and settlement estimate the way Sumopod's
does (`docs/integrasi-sumopod.md`); webhook signing; sandbox; KYB requirements
for PT Jaya Korpora Prima as Platform Operator with YIEM as Collecting Entity;
and anything that conflicts with ADRs on the Payment model.

Output: a cited comparison on branch `research/second-provider`, with a
recommendation the owner then decides on. The choice itself is Dri's.

## Answer

Owner (Dri), 2026-09-28, in the batch triage round
(`prd-audit/triage-2026-09-28.md`, Bagian A Q6): **Xendit** -- confirmed
Foundation/NPO onboarding, the widest VA/e-wallet coverage, Rp2.500/transaction
disbursement, and automatic sandbox. DOKU stays the runner-up (stronger SNAP
signature scheme, weaker confirmed NPO onboarding evidence).

**Precondition before adapter work starts:** neither vendor's webhook payload
was confirmed to carry the fee and settlement-estimate fields the way
Sumopod's does. The first builder on this ticket verifies that directly
against Xendit's own docs (not WebSearch) before writing the adapter --
findings and the field mapping go in this ticket's Answer once checked.
