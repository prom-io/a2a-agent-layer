# Security

## Threat model
The agent layer registers agents, catalogs their services and meters usage. The
assets at risk are agent identities (DID controllers), tariff integrity and the
authenticity of on-chain registrations.

- **Identity spoofing** - registration requires a signature from the DID controller; unverified controllers are rejected.
- **Replay / CSRF** - browser-credentialed routes require a signed double-submit token; server-to-server callers use bearer or API keys and are CSRF-exempt.
- **Privilege escalation** - RBAC (agent / operator / admin) guards every mutating route; audit logging records who changed what.
- **Chain reorg** - registrations wait for a reorg-safe confirmation depth before being treated as final.

## Operational controls
Secrets come from the environment only, never committed. Dual-tier rate limiting
protects the public API. Dependabot keeps dependencies patched. Vulnerable images
are blocked at the registry-push gate.

## Reporting
security@prom.io - please do not open public issues for vulnerabilities.
