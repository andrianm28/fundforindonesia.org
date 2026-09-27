# 09: Is the Volunteer module in Release 1?

**Type:** grilling

**Status:** resolved

## Question

PRD §4 gives the Volunteer a job — a catalogue of Volunteer Trips and Batches,
the Trip Fee, a Registration confirmed after payment, and a certificate. PRD §6
puts Volunteer outside Release 1, at release 3.

The measurement made that untenable to leave as it stood. The module is
unreachable at **both** ends, for everyone and not just the Volunteer:

- no file under `src/app` matches `volunt` — there is no page at all;
- `VolunteerRegistration` appears zero times in `prisma/schema.prisma`, so
  "registering" has no record to write to;
- "sertifikat" has zero hits in `src/`;
- `POST /api/volunteer-trips` exists with a validated `tripFeeAmount` and **no
  screen**;
- `GET /api/moderasi/volunteer-trips` exists, filters on
  `status: 'SUBMITTED'`, and **has no screen** — the moderation area holds
  `campaigns`, `collecting-entities`, `partner-organisations` and `reports`, and
  nothing for Volunteer Trips.

So a Fundraiser can create a Trip with a price through the product, and no
person can approve it. A Trip submitted through the product never leaves
`SUBMITTED`. That is a sixth family of route-without-screen beyond the eleven
Admin ones, and the first where a whole feature is stranded at both ends.

The question was whether to build it, or to close the loop and cut it.

## Answer

Settled by the owner on 2026-09-27.

**Volunteer is in Release 1.**

The reasoning that made the alternative untenable: the glossary already
described the Volunteer as someone who "mendaftar Volunteer Batch dan membayar
Trip Fee-nya" — a flow that has never existed. The entry stated an intention as
a fact, so the gap read as finished work. Deferring the module again would have
left that false description in place with the code still half-open underneath
it.

**The rule that comes with it: no half-open loop.** If the module is in Release
1, both ends are in Release 1. A Trip that can be created must be approvable by
a person, and a Volunteer who registers must reach a payment and a
confirmation. Anything less is the current state with a release label on it.

**The money already has a rule.** ADR 0014 keeps the Trip Fee on the Payment /
Escrow Hold / Payout rails, separate from Donation money even though the
infrastructure is shared. So a Trip Fee is not a Campaign contribution and must
never appear in a Campaign's totals, a Receipt, or a Donor-facing number. The
refund path is also settled: a Batch that misses its minimum quota is cancelled
by the Fundraiser and every Registration that has already paid gets a full
Refund.

## What this does not decide

- **Where the certificate comes from.** A "sertifikat" that renders a
  volunteer's name and a Trip is a document with a person's name on it, and
  whether it is a signed artefact, a printable page, or a record the platform
  merely attests to is unasked. It is also the only item here that touches
  personal data outside the money path.
- **Whether a Batch's minimum quota is enforced at registration or at
  closing.** The glossary says a Batch is cancelled *when the minimum is not
  met by the deadline*, which implies the shortfall is discovered at the end
  and every Registration is refunded then. Whether the platform warns anyone as
  the Batch approaches its quota is not stated, and it is the difference
  between a good experience and a refund crisis.
- **What `escrowHoldDays` is for a Trip.** Escrow Hold is currently a constant
  of `7`, and a Trip Fee is not a donation with a delivery date, so whether a
  Trip holds the same way is not obvious.
- **Whether the Volunteer Trip lifecycle mirrors the Campaign lifecycle or
  diverges.** `VolunteerTripStatusChange` exists, so the history is modelled,
  but no session has read it to see whether the two lifecycles agree. Sharing
  `campaign-lifecycle.ts` with a different status set is a real fork in that
  module.
- **Whether Volunteer is a `Fundraiser` variant or its own thing.** The
  glossary says a `Volunteer Trip` is owned by a Fundraiser, so a Volunteer
  Booking is a second thing a signed-in user does. Whether that needs its own
  page or belongs on the existing dashboard is a layout question, and it is
  cheap to get wrong in a way that makes both screens worse.
