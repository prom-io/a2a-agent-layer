// k6 load profile for the PROM Agent Layer: catalog search and A2A requests.
//
//   k6 run -e BASE_URL=http://localhost:3001 -e API_KEY=<key> k6/agent-layer-load.js
//
// Environment:
//   BASE_URL     service base URL (default http://localhost:3001)
//   API_KEY      service API key, sent as x-api-key (one of the API_KEYS entries)
//   AUTH_TOKEN   alternatively a JWT, sent as a bearer token
//   PROFILE      smoke | load (default) | stress
//   AGENT_TO     DID of the target agent for A2A requests (default did:prom:k6-target)
//
// The target instance has to run with the rate limits raised
// (THROTTLE_SHORT_LIMIT / THROTTLE_LONG_LIMIT), otherwise all traffic from the
// single load-generator IP is answered with 429 and the run measures the
// throttler. 429s are counted separately below so this is visible either way.

import http from 'k6/http';
import { check, fail, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const PROFILE = __ENV.PROFILE || 'load';
const AGENT_TO = __ENV.AGENT_TO || 'did:prom:k6-target';
// An empty term lists the whole catalog; the others exercise the ILIKE search.
const SEARCH_TERMS = ['', 'translate', 'summar', 'image', 'code', 'search'];

const PROFILES = {
  // Sanity run for CI or after a deploy: a few iterations, same thresholds.
  smoke: {
    catalog: [{ duration: '30s', target: 5 }],
    a2a: [{ duration: '30s', target: 2 }],
  },
  // Expected production shape: reads outnumber A2A calls roughly 5:1.
  load: {
    catalog: [
      { duration: '1m', target: 50 },
      { duration: '3m', target: 50 },
      { duration: '30s', target: 0 },
    ],
    a2a: [
      { duration: '1m', target: 10 },
      { duration: '3m', target: 10 },
      { duration: '30s', target: 0 },
    ],
  },
  // Find the knee: keep ramping until latency or errors break the thresholds.
  stress: {
    catalog: [
      { duration: '2m', target: 100 },
      { duration: '2m', target: 200 },
      { duration: '2m', target: 300 },
      { duration: '1m', target: 0 },
    ],
    a2a: [
      { duration: '2m', target: 20 },
      { duration: '2m', target: 40 },
      { duration: '2m', target: 60 },
      { duration: '1m', target: 0 },
    ],
  },
};

const profile = PROFILES[PROFILE];
if (!profile) {
  throw new Error(`Unknown PROFILE "${PROFILE}", expected one of ${Object.keys(PROFILES).join(', ')}`);
}

const throttled = new Counter('throttled_requests');
const a2aAccepted = new Rate('a2a_accepted');
const receiptSigned = new Rate('a2a_receipt_signed');
const catalogSize = new Trend('catalog_result_count');

export const options = {
  scenarios: {
    // Arrival rate, not VUs: a slow server must not reduce the offered load,
    // which is what a closed model silently does.
    catalog_search: {
      executor: 'ramping-arrival-rate',
      exec: 'catalogSearch',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 400,
      stages: profile.catalog,
      tags: { flow: 'catalog' },
    },
    a2a_requests: {
      executor: 'ramping-arrival-rate',
      exec: 'a2aRequest',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 200,
      stages: profile.a2a,
      tags: { flow: 'a2a' },
    },
  },
  thresholds: {
    // Catalog and tariff reads are plain indexed lookups.
    'http_req_duration{flow:catalog}': ['p(95)<250', 'p(99)<600'],
    // An A2A request writes a usage record and signs a receipt.
    'http_req_duration{flow:a2a}': ['p(95)<800', 'p(99)<1500'],
    'http_req_failed{flow:catalog}': ['rate<0.01'],
    'http_req_failed{flow:a2a}': ['rate<0.01'],
    a2a_accepted: ['rate>0.99'],
    a2a_receipt_signed: ['rate>0.99'],
    throttled_requests: ['count<1'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function headers(extra) {
  const base = { 'Content-Type': 'application/json', 'x-request-id': `k6-${__VU}-${__ITER}` };
  if (__ENV.API_KEY) base['x-api-key'] = __ENV.API_KEY;
  if (__ENV.AUTH_TOKEN) base.Authorization = `Bearer ${__ENV.AUTH_TOKEN}`;
  return Object.assign(base, extra || {});
}

function track(res) {
  if (res.status === 429) throttled.add(1);
  return res;
}

// 64 hex characters derived from the iteration, shaped like a keccak256 hash.
// The service recomputes the canonical hash itself and only logs a mismatch.
function pseudoHash(seed) {
  let out = '';
  let state = seed >>> 0;
  while (out.length < 64) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out += state.toString(16).padStart(8, '0');
  }
  return `0x${out.slice(0, 64)}`;
}

export function setup() {
  const health = http.get(`${BASE_URL}/health`);
  if (health.status !== 200) {
    fail(`service is not healthy at ${BASE_URL}/health (status ${health.status})`);
  }
  if (!__ENV.API_KEY && !__ENV.AUTH_TOKEN) {
    fail('set API_KEY or AUTH_TOKEN: every route except the probes requires authentication');
  }

  // Pick real ids once so the detail lookups hit existing rows instead of 404s.
  const services = http.get(`${BASE_URL}/services`, { headers: headers() });
  const list = services.status === 200 ? services.json() : [];
  return {
    serviceIds: Array.isArray(list) ? list.slice(0, 50).map((s) => s.id) : [],
    startedAt: Date.now(),
  };
}

export function catalogSearch(data) {
  group('catalog search', () => {
    // One round trip returns the page and its prices: include=tariffs loads
    // the tariffs of all listed services with a single batched query.
    const term = SEARCH_TERMS[(__VU + __ITER) % SEARCH_TERMS.length];
    const list = track(
      http.get(`${BASE_URL}/services?include=tariffs&limit=50&q=${encodeURIComponent(term)}`, {
        headers: headers(),
        tags: { endpoint: 'GET /services' },
      }),
    );
    const ok = check(list, {
      'services: status 200': (r) => r.status === 200,
      'services: returns a list': (r) => r.status === 200 && Array.isArray(r.json()),
      'services: tariffs embedded': (r) =>
        r.status === 200 && r.json().every((s) => Array.isArray(s.tariffs)),
    });
    if (ok) catalogSize.add(list.json().length);

    // A caller that found a service looks at it and then at its price.
    if (data.serviceIds.length > 0) {
      const id = data.serviceIds[(__VU + __ITER) % data.serviceIds.length];
      const detail = track(
        http.get(`${BASE_URL}/services/${id}`, {
          headers: headers(),
          tags: { endpoint: 'GET /services/:id' },
        }),
      );
      check(detail, { 'service detail: status 200': (r) => r.status === 200 });

      const tariffs = track(
        http.get(`${BASE_URL}/tariffs?serviceId=${id}`, {
          headers: headers(),
          tags: { endpoint: 'GET /tariffs' },
        }),
      );
      check(tariffs, { 'tariffs: status 200': (r) => r.status === 200 });
    }
  });
}

export function a2aRequest(data) {
  // Unique per iteration: the nonce store rejects a repeated nonce with 409.
  const unique = `${data.startedAt}-${__VU}-${__ITER}`;
  const body = {
    agentFromId: `did:prom:k6-caller-${__VU % 25}`,
    agentToId: AGENT_TO,
    sessionId: `k6-session-${unique}`,
    requestPayload: { prompt: `load test ${unique}`, maxTokens: 64 },
    requestHash: pseudoHash(__VU * 100003 + __ITER),
    maxBudget: 1,
    nonce: `k6-nonce-${unique}`,
    signature: '0xk6',
  };

  group('a2a request', () => {
    const res = track(
      http.post(`${BASE_URL}/a2a/request`, JSON.stringify(body), {
        headers: headers(),
        tags: { endpoint: 'POST /a2a/request' },
      }),
    );

    const accepted = res.status === 201;
    a2aAccepted.add(accepted);
    check(res, { 'a2a: status 201': () => accepted });

    const receipt = accepted ? res.json('receipt') : null;
    const signed = Boolean(receipt && receipt.signature && receipt.nonce);
    receiptSigned.add(signed);
    check(res, {
      'a2a: completed': (r) => accepted && r.json('status') === 'completed',
      'a2a: receipt is signed': () => signed,
      'a2a: echoes the request id': (r) => Boolean(r.headers['X-Request-Id']),
    });
  });
}
