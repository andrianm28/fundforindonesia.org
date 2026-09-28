# 18: Which second payment provider carries VA, e-wallet and disbursement?

**Type:** research

**Status:** open

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
