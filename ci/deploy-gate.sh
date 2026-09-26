#!/bin/bash
# The deploy job's gate (.scratch/ci-cd-github-actions, ticket 07).
#
#   ci/deploy-gate.sh [<commit-sha>]
#
# Run by .github/workflows/deploy.yml before anything touches the host. It
# decides what a deploy of <commit-sha> (by default main's head) would ship,
# and refuses unless all of this holds:
#
#   1. the SHA is a full 40-hex commit on main;
#   2. CI (ci.yml) passed on it, on a push to main, with all four of its jobs
#      green: test, build, migrations, ratchet;
#   3. GHCR holds cd.yml's two images for it, :<sha> and :<sha>-migrate;
#   4. each image's buildx provenance (the SLSA v1 attestation stored next to
#      it) describes that very image, built from <commit-sha> of this
#      repository, for the right Dockerfile target, by a cd.yml run on main,
#      the same run for both images.
#
# It then writes to $GITHUB_OUTPUT: sha, app-digest, migrate-digest (the index
# digests, what build-push-action reported and what ops/deploy.sh pulls),
# ci-run and build-run (run IDs, for the job summary).
#
# The digests are computed here from the bytes GHCR served, and every manifest
# and blob fetched by digest is checked against it, so the tag can only name
# content, never forge it. The provenance is not signed, though (GitHub's
# signed attestations need a public repository, see cd.yml): check 4 catches
# a tag that points at the wrong build, not a forger who can already push to
# GHCR, which takes write access to this repository.
#
# Needs: gh, curl, jq, sha256sum. Env: GH_TOKEN (actions: read, packages:
# read), GITHUB_REPOSITORY, GITHUB_ACTOR, GITHUB_OUTPUT.
# Tested with stubbed gh and curl in src/__tests__/deploy-gate.test.ts.
set -euo pipefail

repo="$GITHUB_REPOSITORY"
image="${repo,,}" # GHCR names are lowercase
registry="https://ghcr.io/v2/$image"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

refuse() {
  echo "::error::Refusing to deploy: $*"
  exit 1
}

sha="${1:-}"
if [ -z "$sha" ]; then
  sha="$(gh api "repos/$repo/commits/main" | jq -r .sha)"
fi

# --- 1. A commit on main ----------------------------------------------------------

# Printed with %q so whatever was typed into the dispatch form stays inert.
[[ $sha =~ ^[0-9a-f]{40}$ ]] || refuse "$(printf '%q' "$sha") is not a full 40-hex commit SHA"
# main...sha is "behind" or "identical" exactly when main contains sha. An
# unknown commit is a 404, which gh reports on stderr.
status="$(gh api "repos/$repo/compare/main...$sha" 2> /dev/null | jq -r '.status // empty')" || status=""
case "$status" in
  behind | identical) ;;
  *) refuse "$sha is not on main (compare: ${status:-unknown commit})" ;;
esac

# --- 2. CI ----------------------------------------------------------------------

ci_run="$(gh api "repos/$repo/actions/workflows/ci.yml/runs?head_sha=$sha&branch=main&event=push&status=success" |
  jq -r '.workflow_runs[0].id // empty')"
[ -n "$ci_run" ] || refuse "CI has not passed on $sha (no successful ci.yml run for a push to main)"
# The run's latest attempt; every job ci.yml defines must be among its green ones.
green="$(gh api "repos/$repo/actions/runs/$ci_run/jobs" | jq -r '.jobs[] | select(.conclusion == "success") | .name')"
for job in test build migrations ratchet; do
  grep -qx "$job" <<< "$green" || refuse "CI run $ci_run on $sha has no green \`$job\` job"
done

# --- 3, 4. Images and provenance ------------------------------------------------

token="$(printf 'user = "%s:%s"\n' "$GITHUB_ACTOR" "$GH_TOKEN" |
  curl -fsS -K - "https://ghcr.io/token?service=ghcr.io&scope=repository:$image:pull" | jq -r .token)"

# get <ref> <file> [blob]: a manifest by tag or digest, or a blob by digest.
# Anything fetched by digest must hash to it.
get() {
  local kind=manifests
  [ "${3:-}" = blob ] && kind=blobs
  curl -fsSL -H "Authorization: Bearer $token" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json" \
    -o "$2" "$registry/$kind/$1" 2> /dev/null || return 1
  if [[ $1 == sha256:* ]] && [ "$(digest_of "$2")" != "$1" ]; then
    refuse "GHCR served content for $1 that does not match its digest"
  fi
}
digest_of() { echo "sha256:$(sha256sum "$1" | cut -d' ' -f1)"; }

# verify <tag> <target>: sets digest and run, the index digest of
# ghcr.io/<image>:<tag> and the ID of the cd.yml run that built it.
verify() {
  local tag="$1" target="$2" index="$work/$2.index" att="$work/$2.att" prov="$work/$2.prov"
  local ref="ghcr.io/$image:$tag"
  get "$tag" "$index" || refuse "there is no image $ref (did cd.yml push this commit?)"
  digest="$(digest_of "$index")"

  # buildx's layout: the index lists the image manifest and an attestation
  # manifest that refers to it; the attestation's layer is the provenance.
  local att_digest manifest
  att_digest="$(jq -r 'first(.manifests[]? | select(.annotations["vnd.docker.reference.type"] == "attestation-manifest") | .digest) // empty' "$index")"
  manifest="$(jq -r 'first(.manifests[]? | select(.annotations["vnd.docker.reference.type"] == "attestation-manifest") | .annotations["vnd.docker.reference.digest"]) // empty' "$index")"
  [ -n "$att_digest" ] && [ -n "$manifest" ] || refuse "$ref has no provenance attestation"
  get "$att_digest" "$att" || refuse "$ref has no provenance attestation (manifest $att_digest missing)"
  local prov_digest
  prov_digest="$(jq -r 'first(.layers[]? | select(.annotations["in-toto.io/predicate-type"] == "https://slsa.dev/provenance/v1") | .digest) // empty' "$att")"
  [ -n "$prov_digest" ] || refuse "$ref has no SLSA v1 provenance in its attestation"
  get "$prov_digest" "$prov" blob || refuse "$ref has no provenance (blob $prov_digest missing)"

  jq -e --arg m "${manifest#sha256:}" 'any(.subject[]?; .digest.sha256 == $m)' "$prov" > /dev/null ||
    refuse "the provenance of $ref does not describe its image manifest $manifest"
  local revision source built_target builder
  revision="$(jq -r '.predicate.runDetails.metadata.buildkit_metadata.vcs.revision // empty' "$prov")"
  source="$(jq -r '.predicate.runDetails.metadata.buildkit_metadata.vcs.source // empty' "$prov")"
  built_target="$(jq -r '.predicate.buildDefinition.externalParameters.request.args.target // empty' "$prov")"
  builder="$(jq -r '.predicate.runDetails.builder.id // empty' "$prov")"
  if [ "$revision" != "$sha" ] || [ "$source" != "https://github.com/$repo" ]; then
    refuse "$ref was built from ${source:-?}@${revision:-?}, not https://github.com/$repo@$sha"
  fi
  [ "$built_target" = "$target" ] || refuse "$ref was built for Dockerfile target ${built_target:-?}, not $target"

  local prefix="https://github.com/$repo/actions/runs/"
  run=""
  if [[ $builder == "$prefix"* ]]; then
    run="${builder#"$prefix"}"
    run="${run%%/*}"
  fi
  local where=""
  [[ $run =~ ^[0-9]+$ ]] &&
    where="$(gh api "repos/$repo/actions/runs/$run" 2> /dev/null | jq -r '"\(.path) \(.head_branch)"')" || true
  [ "$where" = ".github/workflows/cd.yml main" ] ||
    refuse "$ref was not built by a cd.yml run on main (builder: ${builder:-none})"
}

verify "$sha" runner
app_digest="$digest" build_run="$run"
verify "$sha-migrate" migrate
migrate_digest="$digest"
[ "$run" = "$build_run" ] ||
  refuse "the app and migrate images of $sha come from different cd.yml runs ($build_run, $run); rerun cd.yml for it"

{
  echo "sha=$sha"
  echo "app-digest=$app_digest"
  echo "migrate-digest=$migrate_digest"
  echo "ci-run=$ci_run"
  echo "build-run=$build_run"
} >> "$GITHUB_OUTPUT"
