# A2A Agent Protocol

This document specifies the wire protocol used between A2A agents managed by
`a2a-agent-layer`. The protocol covers identity proof, service discovery,
request envelopes, metering, and policy enforcement.

## 1. Identity

Each agent is identified by a Decentralized Identifier (DID) of the form:

```
did:prom:<agentId>
```

`<agentId>` is `keccak256(publicKey)[12:32]` (20 bytes, lowercased hex).
Identity records are anchored on-chain in `AgentRegistry.sol`:

| Field        | Type    | Notes                                            |
|--------------|---------|--------------------------------------------------|
| owner        | address | EOA that controls the agent                      |
| did          | string  | Canonical DID string                             |
| publicKey    | string  | secp256k1 public key (uncompressed, 0x-prefixed) |
| endpoint     | string  | HTTPS URL serving the A2A endpoint               |
| active       | bool    | Soft-deactivation flag                           |
| registeredAt | uint256 | Block timestamp                                  |

DID resolution is `GET /identity/:did` on any agent-layer node.

## 2. Service catalog

Each agent publishes its callable services to `ServiceCatalog.sol`. A service
entry includes:

- `serviceId` — keccak of `(agentDid, slug)`
- `slug` — human label (e.g. `summarize-v1`)
- `inputSchema` / `outputSchema` — IPFS CIDs of JSON-Schema documents
- `tariffId` — pointer into `TariffRegistry.sol`
- `flags` — bitfield (streaming, requiresVerification, requiresStake)

## 3. Tariffs and pricing

`TariffRegistry.sol` holds pricing definitions. A tariff is one of:

- **Flat**: fixed `amountMinor` per call.
- **Metered**: `unit` (e.g. `token`, `byte`, `ms`) + `pricePerUnitMinor`.
- **Tiered**: array of `(thresholdUnits, pricePerUnitMinor)` rows.

All amounts are in minor units of the escrow asset (e.g. gwei). Pricing is
quoted at request time; the agent server commits to a quote in the response
envelope so the client cannot be price-gouged mid-stream.

## 4. Request envelope

```
POST <endpoint>/a2a/v1/invoke
Content-Type: application/json
```

```json
{
  "version": 1,
  "requestId": "<uuid>",
  "from": "did:prom:<caller>",
  "to": "did:prom:<callee>",
  "serviceSlug": "summarize-v1",
  "payload": { ... },
  "quote": {
    "tariffId": "0x...",
    "expectedAmountMinor": "5000",
    "expectedAt": "2026-05-20T12:00:00Z"
  },
  "auth": {
    "escrowId": "<uuid>",
    "scheme": "escrow-v1"
  },
  "signature": "0x..."
}
```

`signature` is `secp256k1(keccak256(canonicalJson(envelope without signature)))`
from the caller's private key. The callee MUST verify the signature against
the caller's on-chain `publicKey` before executing.

## 5. Response envelope

```json
{
  "version": 1,
  "requestId": "<uuid>",
  "result": { ... } | null,
  "error": { "code": "...", "message": "..." } | null,
  "metering": {
    "unitsConsumed": "123",
    "amountMinor": "5000",
    "receiptHash": "0x..."
  },
  "signature": "0x..."
}
```

`receiptHash` is the keccak of the canonical receipt JSON described in the
Payment Rail `SETTLEMENT-PROTOCOL.md`. Both client and server retain the
signed envelope as their off-chain audit record.

## 6. Streaming responses

For services with the `streaming` flag, the callee uses
`Transfer-Encoding: chunked` and emits one JSON object per line:

```
{"type":"chunk","seq":0,"data":"..."}
{"type":"chunk","seq":1,"data":"..."}
{"type":"end","metering":{...},"signature":"0x..."}
```

The caller may abort the stream at any time. The agent layer then issues
`POST /streaming/refund` on the payment rail to settle the unconsumed budget;
see `a2a-payment-rail/docs/SETTLEMENT-PROTOCOL.md` §6.

## 7. Policy enforcement

Each agent loads a policy bundle from its `PolicyModule`:

- **Rate**: per-caller cap (calls/min) and burst cap.
- **Allowlist** / **Denylist**: DIDs or address patterns.
- **Schema**: hard reject if `payload` does not satisfy `inputSchema`.
- **Verification**: if `requiresVerification`, the response is queued in the
  verification network before settlement.

Policy violations return `error.code = "policy/<reason>"` with HTTP 403.

## 8. Errors

Canonical error codes:

| code                    | http | meaning                                |
|-------------------------|------|----------------------------------------|
| `auth/bad-signature`    | 401  | Envelope signature does not verify     |
| `auth/no-escrow`        | 402  | Escrow session missing or expired      |
| `policy/rate`           | 429  | Rate limit exceeded                    |
| `policy/denied`         | 403  | Caller is on the denylist              |
| `schema/invalid-input`  | 400  | Payload fails inputSchema validation   |
| `quote/expired`         | 409  | Quote timestamp is outside window      |
| `service/not-found`     | 404  | Service slug not in catalog            |
| `internal/upstream`     | 502  | Upstream model or dependency failure   |

## 9. Versioning

This document tracks protocol version `1`. Backwards-incompatible changes to
the envelope schema, signature scheme, or storage layout bump the major
version. The minor version is implicit in `version` of each envelope and may
add optional fields.
