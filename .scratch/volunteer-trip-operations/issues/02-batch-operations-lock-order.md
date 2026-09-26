# 02: Batch operations in the module, one lock order

**What to build:** `createBatch`, `editBatch`, `cancelBatch` and `completeBatch` move into the Volunteer Trip module, with typed refusals replacing the local error classes. Every Trip operation locks Trip (subject guard) → Batch → Registration → Payment, and the order is documented once in the module. Batch cancel is reordered to match and still refunds every paid Registration in full, through the Refund policy's "batch cancel" case (the policy itself lands in ticket 03; until then keep the current full-refund call behind the same shape). See the spec.

**Blocked by:** 01

**Status:** done

- [ ] The four Batch operations live in the module; the Batch routes are thin
- [ ] Batch cancel takes locks in Trip → Batch → Registration → Payment order, and a test pins the order through the stand-in's lock log
- [ ] Batch cancel refunds each paid Registration in full, and its existing behaviour is unchanged
- [ ] Typed refusals map through `domainErrorToHttp`. Full suite green, tsc adds no errors
