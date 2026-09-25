# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the domain glossary for the whole product.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

This repo is **single-context**: one root `CONTEXT.md`, one `docs/adr/`. There is
no `CONTEXT-MAP.md` and no per-context `src/<context>/docs/adr/`; don't go
looking for them.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-keep-nextjs-prisma-stack.md
│   ├── 0002-one-campaign-entity-for-all-money.md
│   └── …
└── src/
```

ADRs carry a `status:` field in their frontmatter. Check it before relying on
one: ADR-0003 is `superseded by ADR-0006`, and a superseded ADR is history, not
a constraint.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids — each entry lists its own under `_Avoid_`.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0004 (keep it all when target is missed), but worth reopening because…_
