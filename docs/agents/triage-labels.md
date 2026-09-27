# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker (the `Status:` line of each `.scratch/` issue file).

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

`done` is not a triage role; it is this repo's closing status. Set a ticket's `Status:` to `done` once its branch merges to `main`, so the file doesn't go stale against the real git history.

`awaiting-merge` is also not a triage role, and exists because without it a ticket whose work is finished has nowhere honest to sit. `ready-for-agent` would send a coordinator back to build a ticket that is already built; `done` would lie about git history. Set it when the branch is green and the work is complete but the PR is still open, and put the PR number and the commit in `## Comments`. Replace it with `done` at the merge, never before — that transition is the record, and skipping it is how a ticket ends up claiming `done` while its PR is unmerged.

A wayfinding ticket uses `claimed` and `resolved` instead, per the Wayfinding operations section of the issue tracker doc.

Edit the right-hand column to match whatever vocabulary you actually use.
