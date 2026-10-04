# 10: Protect main with the required CI checks

**Blocked by:** 02, 03

**Status:** done

- [x] `main` requires the checks test, build, migrations, ratchet and image to pass before merge (aktualnya test, build, migrations, ratchet, e2e; tanpa image, lihat Comments 2026-10-04)
- [x] Force-push to `main` and deleting `main` are blocked
- [x] Decided and recorded here: whether the owner may bypass (push directly)

Owner applies it in Settings → Branches → Add rule for `main`, or an agent does it through the API only after the owner explicitly allows that call. See `.scratch/ci-cd-github-actions/spec-production-environment.md`.

## Comments

- 2026-09-26: On the current Free plan GitHub refuses both branch protection and rulesets (403 "Upgrade to GitHub Pro or make this repository public") and environment required reviewers (422). The owner chose to upgrade to GitHub Pro. After the upgrade, run:
  - `gh api -X PUT repos/andrianm28/fundforindonesia.org/environments/production` with `reviewers:[{type:User,id:25896940}]`;
  - branch protection on `main` requiring the checks `test`, `build`, `migrations` and `ratchet`, with `strict:false` and `enforce_admins:false`, and blocking force pushes and deletions.
- 2026-09-26: The owner decided to stay on the Free plan. Branch protection, rulesets and environment reviewers are unavailable, so this ticket is wontfix. The "merge only after green CI" rule is kept by the agent workflow (docs/agents/verification.md) and by the deploy job checking CI itself (ticket 07).

- 2026-10-04 (fakta sesi VPS, terverifikasi): branch protection `main` aktif dan mewajibkan check `test`, `build`, `migrations`, `ratchet`, dan `e2e` (github-actions), tanpa force-push dan tanpa penghapusan. Check `image` tidak diwajibkan dan `e2e` diwajibkan; itu satu-satunya beda dari teks kotak pertama. Keputusan bypass: admin boleh bypass, dicatat di sini. Dependabot alerts, secret scanning, dan push protection juga aktif. Pilihan kebijakan deploy "A + reviewer + protection" ada di ci-cd 25. **H-6 (vitest shard 3 arah) wajib mempertahankan job agregat bernama `test`**, karena itu nama check yang diwajibkan.
