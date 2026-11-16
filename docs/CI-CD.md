# CI/CD — Agent Layer

How a change gets from a pull request to staging, what each workflow checks,
which secrets they need, and how to roll back.

```
pull request ──▶ ci (lint, build, unit, e2e, contracts) + commitlint
merge to main ─▶ ci ─▶ image (build → scan → push to GHCR) ─▶ staging-deploy
tag vX.Y.Z ────▶ release (GitHub release) + image (semver tags)
```

## Workflows

All workflows live in `.github/workflows/`. Every job runs on Node 20 (the
`NODE_VERSION` of `ci.yml`, the same major as `docker/Dockerfile`).

### `ci.yml` — every pull request and every push to `main`

Runs are cancelled when a newer commit lands on the same ref. Every job
installs with `npm ci --ignore-scripts`; `NPM_CONFIG_AUDIT` and
`NPM_CONFIG_FUND` are off so the logs only show what matters.

| Job | What it does |
|---|---|
| `lint` | `npx eslint "{src,test}/**/*.ts" --max-warnings 0` (config in `.eslintrc.json`). The `lint` npm script is not used because it passes `--fix`, and CI must not rewrite files and call them green. |
| `build` | `npx tsc --noEmit -p tsconfig.json` (sources, specs, e2e suites and `scripts/`), then `npm run build` (`tsconfig.build.json`, `src` only) and a check that `dist/main.js` exists. |
| `unit` | `npm run test:cov -- --ci --runInBand` with `NODE_ENV=test`; writes a coverage table to the job summary, uploads `coverage/` as an artifact (14 days) and fails below the thresholds in `package.json`. |
| `e2e` | Starts a `postgres:16-alpine` service container (`agent_db`), builds, applies the TypeORM migrations with `npm run migration:run`, then runs `npm run test:e2e -- --ci --runInBand`. |
| `contracts` | Installs Foundry (stable), fetches `forge-std` at the revision pinned in `contracts/foundry.lock`, runs `forge build --sizes` and `forge test -vvv` with a fixed fuzz seed. |

Details worth knowing:

- **Coverage is a ratchet.** The `jest.coverageThreshold` block in
  `package.json` sits just under the measured numbers (statements 53, branches
  50, functions 47, lines 53 at the last ratchet). Raise it when a suite lands;
  never lower it to get a red build through.
- **E2E runs against migrations, not `synchronize`.** The job sets
  `NODE_ENV=test`, so the schema is exactly what `src/migrations/` builds.
  `synchronize` is only on for `NODE_ENV=development`. An entity change without
  a migration fails here with `column ... does not exist`.
- **E2E needs no chain.** `BLOCKCHAIN_PRIVATE_KEY` is the first Anvil account
  and is only used to sign receipts; `BLOCKCHAIN_RPC_URL` points at a port
  nothing listens on. The health detail check accepts a `degraded` status for
  exactly that reason. `JWT_SECRET` and `CSRF_SECRET` are throwaway CI values.
- **The suites raise their own rate limits.** `test/app.e2e-spec.ts` sets
  `THROTTLE_SHORT_LIMIT`/`THROTTLE_LONG_LIMIT` before importing `AppModule`;
  `test/security.e2e-spec.ts` keeps the defaults because it tests the limiter.
- **E2E assumes UTC.** Runners are UTC. The metering rollup compares
  `timestamp` columns with JS dates, so run the suite locally with `TZ=UTC`
  when the machine is in another time zone, or the rollup assertions see an
  empty hour.
- **forge-std is not a real submodule.** `.gitmodules` lists it but the
  repository carries no gitlink, so the job clones exactly the revision from
  `foundry.lock` instead of running `git submodule update`.
- **Fuzzing is reproducible.** `FOUNDRY_FUZZ_SEED` is fixed (`0x70726f6d`), so
  a fuzz failure reproduces on re-run and locally.
- **Caching.** `actions/setup-node` caches `~/.npm` keyed on
  `package-lock.json`. `contracts/lib/forge-std` is cached keyed on
  `foundry.lock`; `contracts/out` and `contracts/cache` are keyed on the
  Solidity sources, `foundry.toml` and `foundry.lock`, with a restore key that
  still gives an incremental build when a contract changes.

Run the same checks locally before pushing:

```bash
npx eslint "{src,test}/**/*.ts" --max-warnings 0
npx tsc --noEmit -p tsconfig.json && npm run build
npm run test:cov -- --ci --runInBand

# needs PostgreSQL; docker-compose.dev.yml exposes one on 5434
docker compose -f docker-compose.dev.yml up -d postgres
export TZ=UTC NODE_ENV=test DATABASE_PORT=5434 JWT_SECRET=local CSRF_SECRET=local
npm run build && npm run migration:run
npm run test:e2e -- --ci --runInBand

cd contracts && forge build --sizes && forge test -vvv
```

### `commitlint.yml` — pull requests

Lints every commit of the pull request, from the base to the head SHA, against
`.commitlintrc.json` (`@commitlint/config-conventional`, header up to 100
characters). Every commit is checked rather than the title alone because
commits are cherry-picked onto `main` one by one. Allowed types: `build`,
`chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`,
`test`.

The CLI and the shared config are devDependencies and are installed from the
lock file: fetching only the CLI through `npx` fails with *Cannot find module
@commitlint/config-conventional*. Pull requests opened by Dependabot are
skipped; their messages are already prefixed by `.github/dependabot.yml` and
nobody can reword them.

Locally: `npm run lint:commits` checks everything since `origin/main`.

### `image.yml` — push to `main`, tags `v*`, manual dispatch

Builds `docker/Dockerfile` (target `runtime`) and publishes it to
`ghcr.io/<owner>/<repo>`. Runs are never cancelled half-way; a second push
queues behind the first so the registry never holds a partial tag set.

1. Build into the local daemon as `agent-layer:scan` (Buildx, GitHub Actions
   layer cache).
2. Trivy scan (`CRITICAL,HIGH`, fixed vulnerabilities only) written as SARIF and
   uploaded to the Security tab. The upload is best-effort: it needs code
   scanning (a public repository or GitHub Advanced Security).
3. **Gate:** a second Trivy pass fails the job on any fixable `CRITICAL`
   finding. Nothing is pushed when it fails.
4. Push, rebuilding from the layer cache of step 1, so the pushed image is the
   scanned one. The digest and tags go to the job summary.

Tags produced:

| Tag | When | Use |
|---|---|---|
| `sha-<40-char commit>` | every build | immutable; what staging deploys and what rollbacks use |
| `main` / `latest` | builds of `main` | convenience only, never deploy these |
| `X.Y.Z`, `X.Y` | `vX.Y.Z` tags | releases |

The runtime image runs as the unprivileged `node` user under `tini`, contains
production dependencies only, and has npm and corepack removed. Its
`HEALTHCHECK` calls `GET /health` on `$PORT` (default 3001), which is public,
exempt from rate limiting and pings the database.

### `staging-deploy.yml` — after `image` succeeds on `main`, or manually

Triggered by `workflow_run` so it never races the image build, and skipped when
the image run failed (for example on the scan gate). One deploy runs at a time.
It:

1. resolves the tag: `sha-<head sha>` of the image run, or the `image_tag`
   input of a manual run. `latest` and `main` are refused;
2. validates `docker-compose.staging.yml` with `docker compose config` against
   `.env.staging.example`, before anything touches the host;
3. copies the compose file of the deployed commit to the host and, over SSH,
   logs in to GHCR with the job token, pulls `agent-layer` and runs
   `docker compose up -d --wait --wait-timeout 180`. On failure it prints
   `compose ps` and the last 100 log lines;
4. records the running tag in `.deployed-tag` (the one before it moves to
   `.previous-tag`), logs out and prunes dangling images;
5. smoke-checks `http://127.0.0.1:3001/health` on the host and fails unless the
   status is `ok`.

When the staging secrets are not configured the job logs a notice, writes
"Deploy skipped" to the summary and ends green.

`docker-compose.staging.yml` pins every image: PostgreSQL by version
(`16.4-alpine`), the service by the mandatory `IMAGE_TAG`. The service runs
with `NODE_ENV=production`, which applies pending migrations at boot and
refuses to start on development secrets. The container is read-only with a
`/tmp` tmpfs, drops every capability and only binds `127.0.0.1:3001`;
`/metrics` is unauthenticated and must stay behind the host's reverse proxy.

### `release.yml` — tags `vX.Y.Z`

Validates that the tag is strict SemVer 2.0.0 (the tag filter is only a glob)
and that the tagged commit is on `main`, then creates a GitHub release with
generated notes and a `docker pull` header. Tags with a pre-release suffix
(`v1.2.0-rc.1`) are marked as pre-releases and do not become *latest*. The
same tag makes `image.yml` publish the `X.Y.Z` and `X.Y` image tags.

```bash
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

### Dependabot

`.github/dependabot.yml` opens weekly pull requests (Monday 06:00 UTC, at most
five open per ecosystem) for npm and GitHub Actions, with `chore(deps)` and
`ci(deps)` prefixes so they pass commitlint. NestJS, OpenTelemetry,
typescript-eslint, commitlint and the test tooling are grouped so packages
that only work at matching versions arrive together; the Docker actions are
grouped as well. Major bumps of ESLint, typescript-eslint and `@types/node` are
ignored and done by hand.

## Secrets and variables

The `ci`, `commitlint`, `image` and `release` workflows need nothing beyond the
built-in `GITHUB_TOKEN` (`packages: write` and `security-events: write` for
`image`, `contents: write` for `release`).

`staging-deploy` uses the `staging` environment:

| Name | Kind | Purpose |
|---|---|---|
| `STAGING_SSH_HOST` | secret | staging host name or address |
| `STAGING_SSH_USER` | secret | deploy user, member of the `docker` group |
| `STAGING_SSH_KEY` | secret | private key of the deploy user; removed from the runner at the end of the job |
| `STAGING_SSH_KNOWN_HOSTS` | secret, recommended | pinned host key line; without it the key is trusted on first use |
| `STAGING_DEPLOY_PATH` | variable, optional | directory on the host, default `/opt/a2a-agent-layer` |

Application secrets never pass through GitHub. They live on the staging host in
`<deploy path>/.env.staging` (template: `.env.staging.example`): `JWT_SECRET`,
`CSRF_SECRET`, `POSTGRES_PASSWORD`, `API_KEYS`, `CORS_ORIGINS`,
`BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`, `PROM_TESTNET_RPC_URL` and
`AGENT_REGISTRY_ADDRESS` (empty keeps registration off-chain). Create the file
once with mode `600`; the workflow only supplies the image coordinates and
refuses to deploy when the file is missing.

Protect the `staging` environment with required reviewers if deploys should be
approved by a person.

## Rollback

### Service

Images are immutable per commit, so a rollback is a redeploy of an older tag.

- **From GitHub:** run `staging-deploy` manually (*Actions → staging-deploy →
  Run workflow*) with `image_tag` set to the previous `sha-<commit>` or release
  version.
- **From the host:**

  ```bash
  cd /opt/a2a-agent-layer
  cat .previous-tag                  # what ran before the current deploy
  IMAGE_REPOSITORY=ghcr.io/<owner>/a2a-agent-layer IMAGE_TAG="$(cat .previous-tag)" \
    docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --wait
  echo "$(cat .previous-tag)" > .deployed-tag
  ```

Then revert the offending commit on `main`; otherwise the next merge deploys it
again.

### Database

Migrations run forward automatically at boot and are **not** reverted by
deploying an older image. Older code keeps working as long as a migration only
adds tables, indexes or nullable/defaulted columns, which is the rule for this
repository. If a migration has to be undone, stop the service and revert it
explicitly with the image that contains it:

```bash
compose() { docker compose --env-file .env.staging -f docker-compose.staging.yml "$@"; }
compose exec postgres pg_dump -U agent_layer agent_db > agent_db-$(date +%F).sql
compose stop agent-layer
compose run --rm agent-layer node node_modules/typeorm/cli.js migration:revert -d dist/config/data-source.js
```

`migration:revert` undoes one migration per run, the newest first. `down`
migrations drop the tables and columns they added, so take the dump first.

### Contracts

`AgentRegistry`, `ServiceCatalog` and `TariffRegistry` are not upgradeable.
Rolling back means pointing the service at the previous deployment addresses
in `.env.staging` (see `deployments/prom-testnet.json` and *Rollback* in
`docs/TESTNET.md`). Leaving `AGENT_REGISTRY_ADDRESS` empty takes the service
off-chain entirely; registrations then only land in the database.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `e2e` fails with `column ... does not exist` | an entity changed without a migration |
| `e2e` rollup or `/metrics` assertions fail only locally | the machine is not on UTC; run with `TZ=UTC` |
| `unit` fails with `coverage threshold ... not met` | new code landed without tests; add tests rather than lowering the threshold |
| `build` fails at *Typecheck* but `npm run build` passes locally | a spec, e2e suite or script does not compile; `tsconfig.build.json` skips them |
| `contracts` fails at *Install forge-std* | `foundry.lock` lost its pinned revision |
| `image` fails at *Fail on critical findings* | a fixable critical CVE in the base image or a dependency; bump it (Dependabot usually has a PR open) |
| `commitlint` fails | a commit subject is not `type: description` or is longer than 100 characters |
| `staging-deploy` is green but nothing changed | the staging secrets are missing; the summary says "Deploy skipped" |
| `staging-deploy` fails at *Pull and restart* with `missing .env.staging` | the application secrets file was never created on the host |
| `release` fails at *Validate semantic version* | the tag is not `vMAJOR.MINOR.PATCH[-prerelease]` |
