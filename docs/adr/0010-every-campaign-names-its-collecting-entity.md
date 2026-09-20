---
status: accepted
---

# Every Campaign names the legal entity that collects its money

The PRD's last open question warns that Indonesian rules on penghimpunan dana sosial expect the permit holder to be a yayasan or perkumpulan, while the Platform Operator is a PT (ADR 0009). We settle it by making the collecting entity an attribute of each Campaign rather than a property of the platform: every Campaign names the Partner Organisation under whose permit it collects, and the Platform Operator never collects in its own name. A Campaign of a given Kind can only open if its collecting entity holds a permit for that Kind that has not expired, which is the Kind Authorisation mechanism moved one level out so the permit gates the Campaign and not only the organisation.

## Considered options

- The Platform Operator collects everything and permits are handled offline. Rejected: if counsel comes back saying a PT may not collect public donations, every Receipt, every ledger split, and every Payout path would have to be rewritten with live money already in the system.
- One collecting entity as a platform-wide setting. Rejected: it cannot express more than one Partner Organisation, and a platform whose premise is many partners running many programs would outgrow it immediately.
- A collecting entity per Campaign. Accepted.

## Consequences

- Receipt and Akad Wakaf name the collecting entity, not the platform. A Donor's legal counterparty is the Partner Organisation.
- A Fundraiser who is an individual cannot open a Campaign without a Partner Organisation sponsoring it. This is a product restriction and not merely a schema one: it narrows who can fundraise on day one, and the campaign-creation flow has to say so.
- The collection bank account per Kind belongs to the collecting entity and may sit at a different legal entity from the Merchant Account, which stays with the Platform Operator. Ledger entries carry the collecting entity so that money held for two entities never reads as one pot.
- The 18 September PRD's mitigation, "batasi jalur kontribusi yang dibuka bila izin belum siap", becomes a rule the system enforces instead of something an operator has to remember.
