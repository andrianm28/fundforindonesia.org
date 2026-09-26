# 23: Create the production environment and its secrets

**What to build:** In GitHub, Settings → Environments → New environment
`production`:
1. Required reviewers: andrianm28. Leave "Prevent self-review" as GitHub
   allows for a single-owner repo, and record the choice here.
2. Deployment branches and tags: Selected branches → `main` only.
3. Environment secrets: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`
   (values from the cutover, ticket 08). Do not create them as repo secrets;
   if any already exists as a repo secret, delete it.

An agent may do steps 1–2 through the API only after the owner explicitly
allows it. Secret values are always entered by the owner.

**Blocked by:** none for steps 1–2; step 3 needs ticket 08's deploy user and key

**Status:** ready-for-human

- [ ] `production` exists with the owner as required reviewer and `main` as the only deployment branch
- [ ] The three deploy secrets exist only as environment secrets
- [ ] A dispatch of `deploy.yml` (after ticket 24) waits for the owner's approval before the deploy job starts
