# Public repo cleanup

Source: owner, via the VPS session's update of 2026-09-26 ("Perapian penamaan
'kitabisa' (repo publik)"). The repository went public on 2026-09-26. It began
as a Kitabisa clone (`.kiro/specs/kitabisa-clone/`), and the name still shows
in the package name, a dead component that links to Kitabisa's real social
accounts, seed accounts, test fixtures and comments.

Goal: the public tree reads as Fund for Indonesia (`fundforindonesia.org`,
`publicUrl()`), without pointing at a real third party or leaking seed
passwords. Git history is **not** rewritten.

Out of scope: `.scratch/` history notes, the git history, and `.kiro/specs/`
content (marked as history, not edited).
