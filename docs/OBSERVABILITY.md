# Observability — Agent Layer

How to see what `a2a-agent-layer` is doing: structured logs, Prometheus metrics, OpenTelemetry traces, the Grafana dashboard, the alert rules and what to do when one fires.

| Signal | Where it comes from | Where it goes |
|--------|---------------------|---------------|
| Logs | `src/common/logging/` (pino) | stdout, one JSON object per line |
| Metrics | `src/observability/` (prom-client) | `GET /metrics`, scraped by Prometheus |
| Traces | `src/observability/tracing.ts` (OpenTelemetry SDK) | OTLP/HTTP to a collector, off by default |
| Health | `src/modules/health/` | `GET /health`, `GET /ready`, `GET /health/detail` |

## Logs

`PinoLoggerService` replaces the Nest console logger (`main.ts`, `app.useLogger`). Existing `new Logger(Context)` call sites are unchanged; their output becomes JSON:

```json
{"level":30,"time":"2026-10-05T14:03:11.412Z","service":"a2a-agent-layer","env":"production","context":"MeteringService","requestId":"6f1c…","traceId":"4bf9…","spanId":"00f0…","msg":"Receipt created for session …"}
```

- **`requestId`** is the `x-request-id` of the HTTP request that caused the line. `RequestIdMiddleware` reuses the header when the caller sends one (so one id spans the calling agent, this service and the payment rail), generates a UUID otherwise, echoes it in the response, and stores it in async local storage — services never pass it around.
- **`traceId` / `spanId`** are present while a span is active, i.e. only when tracing is enabled.
- JSON strings logged by the audit interceptor are flattened into fields instead of being nested in `msg`.
- `authorization`, `cookie` and `x-api-key` headers, `privateKey`, `password`, `ownerSignature` and `refreshToken` fields are replaced with `[redacted]`.

| Env var | Default | Purpose |
|---------|---------|---------|
| `LOG_LEVEL` | `debug` (`info` in production) | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `LOG_PRETTY` | `true` only when `NODE_ENV=development` | Human-readable output through `pino-pretty`. It is a devDependency: do not enable it in the production image |

Find everything one request did:

```bash
docker logs agent-layer 2>&1 | jq -c 'select(.requestId == "<x-request-id from the response>")'
```

## Metrics

`GET /metrics` returns the Prometheus text format. The route is public and exempt from rate limiting because the scraper sends no credentials; keep it reachable from the monitoring network only. Every series carries `service="a2a-agent-layer"`.

### HTTP

| Series | Type | Labels | Source |
|--------|------|--------|--------|
| `http_requests_total` | counter | `method`, `status` | `HttpMetricsMiddleware` — every request, including ones rejected by the throttler or auth and unknown routes. A client disconnect is recorded as `499` |
| `http_request_duration_seconds` | histogram | `method`, `status` | same; buckets 5 ms – 10 s |
| `http_requests_in_flight` | gauge | — | same |
| `http_controller_duration_seconds` | histogram | `controller`, `handler`, `method`, `route`, `status` | `ControllerMetricsInterceptor` — requests that reached a handler; buckets 5 ms – 60 s because agent registration waits for an on-chain receipt |

`route` is always the route template (`/services/:id`), never a concrete URL. The transport-level series have no path label at all, so unrouted URLs cannot create series. Scrapes of `/metrics` are not counted.

### Domain

Read from the database on scrape by `DomainGaugesService` and cached for `DOMAIN_METRICS_TTL_MS`.

| Series | Labels | Meaning |
|--------|--------|---------|
| `agent_layer_agents` | `status` = `active` \| `inactive` | Registered agents |
| `agent_layer_services` | `status` = status of the owning agent | Catalog services; `inactive` means delisted together with its agent |
| `agent_layer_usage_records` | `status` = `pending` \| `rolled_up` | Usage records of the last `DOMAIN_METRICS_USAGE_WINDOW_HOURS` hours; `pending` = no hourly rollup row for that agent and hour yet |
| `agent_layer_metering_lag_seconds` | — | Age of the oldest pending usage record in that window (0 when none) |
| `agent_layer_domain_metrics_refresh_errors_total` | — | Failed database reads; the gauges keep their last values while this grows |

Recorded by the services through `BusinessMetricsService`:

| Series | Labels | Recorded by |
|--------|--------|-------------|
| `agent_layer_policy_decisions_total` | `decision` = `allow` \| `deny`, `reason` | `PolicyEvaluatorService.assertAllowed`, once per A2A request. `reason` is the evaluator's fixed reason text as a slug, e.g. `subject_on_denylist`, `no_matching_allow_rule`, `no_active_policy` |
| `agent_layer_metering_rollup_runs_total` | `result` = `success` \| `failure` | `MeteringRollupJob.runHourlyRollup` |
| `agent_layer_metering_rollup_last_success_timestamp_seconds` | — | same, on success |
| `agent_layer_metering_rollup_last_buckets` | — | Agent-hour buckets written by the last successful run |

### Runtime

prom-client default metrics with the `agent_layer_` prefix: `agent_layer_process_cpu_seconds_total`, `agent_layer_process_resident_memory_bytes`, `agent_layer_nodejs_eventloop_lag_seconds` (plus `agent_layer_nodejs_eventloop_lag_p50_seconds`, `…_p90_…`, `…_p99_…`), `agent_layer_nodejs_heap_size_used_bytes`, `agent_layer_nodejs_gc_duration_seconds`, and the rest of the standard set.

| Env var | Default | Purpose |
|---------|---------|---------|
| `DOMAIN_METRICS_TTL_MS` | `15000` | How long the domain gauges are cached between database reads |
| `DOMAIN_METRICS_USAGE_WINDOW_HOURS` | `24` | Window for the usage and metering-lag gauges |

### Scraping

`monitoring/prometheus.example.yml` is a working configuration: copy it, set the target, and mount `monitoring/alerts.yml` next to it (it is referenced through `rule_files`).

```bash
curl -s http://localhost:3001/metrics | grep -E '^(http_requests_total|agent_layer_agents)'
```

## Tracing

The OpenTelemetry SDK is started by `src/observability/tracing.bootstrap.ts`, which `main.ts` imports before anything else so that `http`, `express` and `pg` are instrumented when they load. Spans are exported over OTLP/HTTP in batches and flushed on shutdown (`TracingModule`).

Tracing is **off by default**. It turns on when an endpoint is configured:

| Env var | Default | Purpose |
|---------|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Collector base URL, e.g. `http://otel-collector:4318`; `/v1/traces` is appended |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | unset | Full traces URL; takes precedence over the base URL |
| `OTEL_ENABLED` | unset | `true` forces tracing on (export to `http://localhost:4318`), `false` forces it off |
| `OTEL_SDK_DISABLED` | unset | `true` always disables the SDK |
| `OTEL_SERVICE_NAME` | `a2a-agent-layer` | `service.name` resource attribute |
| `OTEL_TRACES_SAMPLER_ARG` | `1` | Fraction of new traces sampled (0–1). A trace started upstream keeps the caller's decision |

What a trace contains:

- one server span per HTTP request (not for `/health`, `/health/detail`, `/ready`, `/metrics`), with Express and PostgreSQL child spans;
- a `blockchain.<operation>` client span around each on-chain call — `blockchain.signMessage` for receipt signing and `blockchain.AgentRegistry.registerAgent | updateAgent | deactivateAgent` around the whole retried transaction including the wait for the receipt. Attributes: `server.address` (RPC host), `agent.did`, `blockchain.contract`, `blockchain.tx_hash`, `blockchain.block_number`, `request.id`. A rejected call or a reverted receipt marks the span as an error;
- the JSON-RPC requests made by ethers carry a W3C `traceparent` header, so an RPC gateway that supports it continues the same trace.

New on-chain calls should go through `BlockchainService.traced(operation, attributes, fn)`.

## Health

| Endpoint | Auth | Use |
|----------|------|-----|
| `GET /health` | public | Liveness; includes a database ping |
| `GET /ready` | public | Readiness for orchestrator probes |
| `GET /health/detail` | role `operator`, `admin` or `service` (API key) | Every dependency with its probe latency |

```bash
curl -s -H "x-api-key: $API_KEY" http://localhost:3001/health/detail | jq
```

```json
{
  "status": "degraded",
  "dependencies": [
    { "name": "database", "status": "up", "latencyMs": 1.42, "critical": true },
    { "name": "blockchain", "status": "down", "latencyMs": 2000.31, "critical": false, "error": "timed out after 2000ms" }
  ]
}
```

`status` is `down` when the database probe fails and `degraded` when only the RPC node does: catalog, pricing and policy reads keep working without the chain. Probes run in parallel and each is abandoned after `HEALTH_CHECK_TIMEOUT_MS` (default `2000`).

## Dashboard

`grafana/agent-request-throughput.json` — *Agent Layer / Request Throughput*. Import it in Grafana (Dashboards → New → Import) and pick the Prometheus data source when asked.

| Row | Panels |
|-----|--------|
| Traffic | request rate, 5xx ratio, in-flight requests, A2A request rate, active agents, listed services, rate by status and by endpoint |
| Latency | p50/p95/p99 over all requests, p95 by endpoint, catalog and pricing read p95, error rate by endpoint |
| Agents, catalog and metering | agents and services by status, usage records by rollup status, metering lag, gauge refresh errors, policy decisions, rollup runs |
| Runtime | event loop lag, memory, CPU |

The `Controller` variable filters the per-endpoint panels. `metrics.smoke.spec.ts` fails if the dashboard queries a series the service does not expose.

## Alerts and runbook

Rules live in `monitoring/alerts.yml`. `critical` pages, `warning` goes to the team channel. `alert-rules.spec.ts` checks that every rule only uses series the service registers.

| Alert | Fires when | Severity |
|-------|------------|----------|
| `AgentLayerDown` | scrape target down for 2 min | critical |
| `AgentLayerDomainMetricsStale` | more than 3 failed gauge refreshes in 10 min | warning |
| `MeteringLagHigh` / `MeteringLagCritical` | oldest pending usage record older than 2 h / 6 h for 15 min | warning / critical |
| `MeteringRollupFailing` | 2 or more failed rollup runs in 3 h | warning |
| `MeteringRollupStalled` | no successful rollup for 2.5 h | warning |
| `PolicyDenialRateHigh` | more than 20 % of policy decisions are denials for 10 min, with traffic above 0.05 req/s | warning |
| `PolicyDenialSpike` | more than 50 denials with one reason in 5 min | critical |

### AgentLayerDown

1. `curl -s http://<host>:3001/health` from the Prometheus host. No answer: the process or the network path is down — check the container (`docker ps`, `docker logs --tail 100 agent-layer`).
2. `/health` answers but `/metrics` does not: check that the scrape target and port in the Prometheus config match the deployment.
3. A crash loop right after a deploy usually is configuration: in production the service refuses to start without `JWT_SECRET` and `CSRF_SECRET`. Roll back to the previous image tag if the cause is not obvious within minutes.

### AgentLayerDomainMetricsStale

The database reads behind the domain gauges fail; the gauges show their last good values and `MeteringLag*` cannot be trusted.

1. `GET /health/detail` — is `database` up, and how slow is the probe?
2. Search the logs for `Domain gauges refresh failed` (context `DomainGaugesService`) for the database error.
3. Statement timeouts on a very large `usage_records` table: lower `DOMAIN_METRICS_USAGE_WINDOW_HOURS` and raise `DOMAIN_METRICS_TTL_MS`.

### MeteringLagHigh

Usage is recorded but not rolled up. Billing reads the rollups, so the lag is revenue not yet charged — it is not lost, the raw `usage_records` are still there.

1. Check the *Metering rollup runs* panel: are runs failing (go to [MeteringRollupFailing](#meteringrollupfailing)) or not happening at all?
2. Confirm the schedule: the log line `Metering rollup job scheduled every <n>ms` at startup shows the effective `METERING_ROLLUP_INTERVAL_MS`.
3. Once the cause is fixed, missed hours are recovered by running the job for a timestamp inside each missed hour (`MeteringRollupJob.runHourlyRollup(referenceDate)`); the upsert makes re-runs safe. See `docs/OPERATIONS-RUNBOOK.md`, "Hourly metering rollups".
4. The alert clears when no usage record of the last 24 h is older than 2 h without a rollup.

### MeteringRollupFailing

1. Filter the logs for `"context":"MeteringRollupJob"` at level `error` (`Hourly metering rollup failed`) — the database error is in `err.message`.
2. Database down or slow: see `GET /health/detail`; the job retries on the next interval by itself.
3. A constraint or schema error after a deploy means a migration is missing: run `npm run migration:run`.
4. For `MeteringRollupStalled` with no failures at all, the interval timer is not firing: check that the instance has been up longer than one interval and restart it if `agent_layer_metering_rollup_last_success_timestamp_seconds` does not move.

### PolicyDenialRateHigh

1. Open the *Policy decisions* panel and look at `reason`:
   - `subject_on_denylist` — a blocked caller keeps retrying. Find it in the logs (`Policy denied: agent=…`) and contact its operator; the service is behaving correctly.
   - `no_matching_allow_rule` — an allow rule no longer matches. Compare with the most recent `PATCH /policies/:id` in the audit log (`"context":"AuditLog"`).
   - `matched_deny_access_rule` — a deny rule is broader than intended (wildcard subject).
2. A wrong policy can be switched off without deleting it: `PATCH /policies/:id` with `{"isActive": false}`.
3. For `PolicyDenialSpike`, the `reason` label of the alert tells which of the cases above applies.

## Load testing

`k6/agent-layer-load.js` drives two flows at independent arrival rates: catalog search (`GET /services?include=tariffs&q=…`, then a service and its tariffs) and A2A requests (`POST /a2a/request` with a unique nonce).

```bash
k6 run -e BASE_URL=http://localhost:3001 -e API_KEY=<key> -e PROFILE=smoke k6/agent-layer-load.js
```

Profiles: `smoke`, `load` (default: 50 catalog iterations/s and 10 A2A requests/s for 3 minutes), `stress`. Thresholds: catalog p95 < 250 ms, A2A p95 < 800 ms, error rate < 1 %, no throttled requests. Raise `THROTTLE_SHORT_LIMIT` and `THROTTLE_LONG_LIMIT` on the target, otherwise the single load-generator IP is rate limited and the `throttled_requests` threshold fails the run.

Catalog listing cost is constant in the number of services: `GET /services?include=tariffs` runs one query for the page and one batched `serviceId IN (…)` query for all its tariffs, and `GET /tariffs?serviceId=` filters in the database (`catalog.service.spec.ts` asserts the query count).

## Related tests

```bash
npm test -- observability        # metrics, gauges, tracing, alert rules, smoke
npm test -- logging              # pino logger and request context
npm test -- health.service       # /health/detail probes
```
