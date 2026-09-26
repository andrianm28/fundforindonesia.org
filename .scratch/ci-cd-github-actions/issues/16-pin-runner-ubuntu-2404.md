# 16: Pin every workflow to ubuntu-24.04

**What to build:** GitHub moves the `ubuntu-latest` label to Ubuntu 26 on
2026-10-19. Every job in `.github/workflows/` (ci.yml, cd.yml, deploy.yml)
runs on `ubuntu-latest` today, so the image, Postgres service and toolchain
would change under us without a PR. Pin them to `ubuntu-24.04`; moving to 26
later is its own deliberate PR.

**Blocked by:** none. Must merge before 2026-10-19.

**Status:** ready-for-agent

- [ ] No workflow uses `ubuntu-latest`; every `runs-on` is `ubuntu-24.04`
- [ ] CI (test, build, migrations, ratchet) and `image` are green on the PR
- [ ] `deploy.yml` is changed but not dispatched (deploys stay the owner's)
