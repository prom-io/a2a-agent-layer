// This suite sends more than ten requests a second from one address, which is
// the short-window rate limit. The limits are read when AppModule is imported,
// so they have to be raised before the imports below. Rate limiting itself is
// covered by security.e2e-spec.ts with the default limits.
process.env.THROTTLE_SHORT_LIMIT = '1000';
process.env.THROTTLE_LONG_LIMIT = '10000';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ethers } from 'ethers';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Role } from '../src/common/auth/roles.enum';
import { MeteringRollupJob } from '../src/modules/metering/metering-rollup.job';
import { hashCanonicalRequest } from '../src/common/crypto/request-canonicalization';
import { buildRegistrationMessage } from '../src/modules/identity/did-controller';

describe('Agent Layer (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let rollupJob: MeteringRollupJob;
  let agentId: string;

  // Unique per run so the suite can be repeated against the same database.
  const run = Date.now().toString(36);
  const agentDid = `did:prom:e2e-agent-${run}`;

  const bearer = (role: Role) =>
    `Bearer ${jwt.sign({ sub: `e2e-${role}`, did: `did:prom:e2e-${role}`, role })}`;

  const buildA2aBody = (overrides: Record<string, unknown> = {}) => {
    const base: Record<string, unknown> = {
      agentFromId: 'did:prom:e2e-caller',
      agentToId: `did:prom:e2e-target-${run}`,
      sessionId: `e2e-session-${run}`,
      requestPayload: { prompt: 'e2e test' },
      maxBudget: 1,
      signature: '0xsig',
      ...overrides,
    };
    const requestHash = hashCanonicalRequest({
      agentFromId: base.agentFromId as string,
      agentToId: base.agentToId as string,
      sessionId: base.sessionId as string,
      requestPayload: base.requestPayload,
      maxBudget: base.maxBudget as number,
      nonce: base.nonce as string | undefined,
      policyDigest: base.policyDigest as string | undefined,
    });
    return { ...base, requestHash };
  };

  const registrationBody = async (did: string) => {
    const owner = ethers.Wallet.createRandom();
    const claim = {
      agentDid: did,
      owner: owner.address,
      publicKey: '0x04abcdef',
      endpoint: 'http://test-agent:8080',
    };
    return { ...claim, ownerSignature: await owner.signMessage(buildRegistrationMessage(claim)) };
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-secret';
    process.env.CSRF_SECRET = process.env.CSRF_SECRET ?? 'e2e-csrf-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    jwt = app.get(JwtService);
    // listen(0) binds once on a random port; with init() alone every parallel
    // supertest call would try to bring the server up itself.
    await app.listen(0);
    rollupJob = moduleFixture.get(MeteringRollupJob);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('/health (GET)', () => {
    it('should return ok', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
          expect(res.body.service).toBe('a2a-agent-layer');
        });
    });

    it('reports per-dependency latencies to an operator only', async () => {
      await request(app.getHttpServer()).get('/health/detail').expect(401);
      await request(app.getHttpServer())
        .get('/health/detail')
        .set('Authorization', bearer(Role.AGENT))
        .expect(403);

      const res = await request(app.getHttpServer())
        .get('/health/detail')
        .set('Authorization', bearer(Role.OPERATOR))
        .expect(200);

      const database = res.body.dependencies.find((d: { name: string }) => d.name === 'database');
      expect(database).toMatchObject({ status: 'up', critical: true });
      expect(typeof database.latencyMs).toBe('number');
      // No RPC node runs next to the suite, so the chain probe may be down;
      // that must degrade the status, never take it down.
      expect(['ok', 'degraded']).toContain(res.body.status);
    });
  });

  describe('/agents (POST)', () => {
    it('should register a new agent', async () => {
      const res = await request(app.getHttpServer())
        .post('/agents')
        .set('Authorization', bearer(Role.OPERATOR))
        .send(await registrationBody(agentDid))
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.agentDid).toBe(agentDid);
      expect(res.body.status).toBe('active');
      agentId = res.body.id;
    });

    it('rejects a registration whose signature is from another key', async () => {
      const body = await registrationBody(`did:prom:e2e-forged-${run}`);
      body.owner = ethers.Wallet.createRandom().address;

      await request(app.getHttpServer())
        .post('/agents')
        .set('Authorization', bearer(Role.OPERATOR))
        .send(body)
        .expect(403);
    });

    it('should reject invalid body', () => {
      return request(app.getHttpServer())
        .post('/agents')
        .set('Authorization', bearer(Role.OPERATOR))
        .send({ invalidField: 'value' })
        .expect(400)
        .expect((res) => {
          expect(res.body.statusCode).toBe(400);
        });
    });
  });

  describe('/agents (GET)', () => {
    it('should list agents', () => {
      return request(app.getHttpServer())
        .get('/agents')
        .set('Authorization', bearer(Role.AGENT))
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBeGreaterThanOrEqual(1);
        });
    });
  });

  describe('/agents/:id (GET)', () => {
    it('should return 404 for non-existent agent', () => {
      return request(app.getHttpServer())
        .get('/agents/00000000-0000-0000-0000-000000000000')
        .set('Authorization', bearer(Role.AGENT))
        .expect(404);
    });
  });

  describe('/services (GET)', () => {
    it('returns a page of services with their tariffs embedded', async () => {
      const auth = bearer(Role.OPERATOR);
      const name = `e2e-translate-${run}`;
      const service = await request(app.getHttpServer())
        .post('/services')
        .set('Authorization', auth)
        .send({ agentId, name, description: 'Translates 100% of the text' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/tariffs')
        .set('Authorization', auth)
        .send({ agentId, serviceId: service.body.id, type: 'per_request', basePrice: '0.5' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/services')
        .query({ include: 'tariffs', q: name.toUpperCase(), agentId, limit: 10 })
        .set('Authorization', auth)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(service.body.id);
      expect(res.body[0].tariffs).toHaveLength(1);
      expect(res.body[0].tariffs[0].serviceId).toBe(service.body.id);

      const priced = await request(app.getHttpServer())
        .get('/tariffs')
        .query({ serviceId: service.body.id })
        .set('Authorization', auth)
        .expect(200);
      expect(priced.body).toHaveLength(1);
    });

    it('rejects an unknown filter', async () => {
      await request(app.getHttpServer())
        .get('/services')
        .query({ include: 'everything' })
        .set('Authorization', bearer(Role.AGENT))
        .expect(400);
    });
  });

  describe('/a2a/request (POST)', () => {
    it('rejects replayed nonces with 409', async () => {
      const body = buildA2aBody({ nonce: `e2e-nonce-replay-${run}`, sessionId: `e2e-replay-${run}` });
      const auth = bearer(Role.AGENT);

      const first = await request(app.getHttpServer())
        .post('/a2a/request')
        .set('Authorization', auth)
        .send(body)
        .expect(201);
      expect(first.body.status).toBe('completed');
      expect(first.body.receipt.signature).toMatch(/^0x[0-9a-f]+$/);

      await request(app.getHttpServer())
        .post('/a2a/request')
        .set('Authorization', auth)
        .send(body)
        .expect(409);
    });

    it('returns 403 when policy denies the caller subject', async () => {
      const targetAgentId = `did:prom:e2e-policy-target-${run}`;
      await request(app.getHttpServer())
        .post('/policies')
        .set('Authorization', bearer(Role.OPERATOR))
        .send({
          agentId: targetAgentId,
          name: 'e2e-deny-caller',
          rules: {
            accessRules: [
              {
                effect: 'allow',
                subjects: ['did:prom:*'],
                actions: ['invoke'],
              },
              {
                effect: 'deny',
                subjects: ['did:prom:blocked-caller'],
                actions: ['invoke'],
              },
            ],
          },
        })
        .expect(201);

      const body = buildA2aBody({
        agentFromId: 'did:prom:blocked-caller',
        agentToId: targetAgentId,
        sessionId: `e2e-policy-deny-${run}`,
        nonce: `e2e-nonce-policy-${run}`,
      });

      await request(app.getHttpServer())
        .post('/a2a/request')
        .set('Authorization', bearer(Role.AGENT))
        .send(body)
        .expect(403);
    });
  });

  describe('metering rollup job', () => {
    it('runs idempotently for the same hour bucket', async () => {
      const ref = new Date();
      const first = await rollupJob.runHourlyRollup(ref);
      const second = await rollupJob.runHourlyRollup(ref);
      expect(first).toBeGreaterThanOrEqual(1);
      expect(second).toBe(first);
    });
  });

  describe('/metrics (GET)', () => {
    it('exposes what the requests above did, without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/metrics').expect(200);

      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toMatch(/^http_requests_total\{method="POST",status="201"[^}]*\} \d+$/m);
      expect(res.text).toMatch(
        /^http_controller_duration_seconds_count\{[^}]*controller="protocol",handler="handleRequest",method="POST",route="\/a2a\/request",status="409"[^}]*\} 1$/m,
      );
      expect(res.text).toMatch(/^agent_layer_agents\{status="active"[^}]*\} [1-9]\d*$/m);
      expect(res.text).toMatch(/^agent_layer_services\{status="active"[^}]*\} [1-9]\d*$/m);
      expect(res.text).toMatch(/^agent_layer_usage_records\{status="rolled_up"[^}]*\} [1-9]\d*$/m);
      expect(res.text).toMatch(
        /^agent_layer_policy_decisions_total\{decision="deny",reason="matched_deny_access_rule"[^}]*\} 1$/m,
      );
      expect(res.text).toMatch(/^agent_layer_metering_rollup_runs_total\{result="success"[^}]*\} 2$/m);
      expect(res.text).toMatch(/^agent_layer_domain_metrics_refresh_errors_total\{[^}]*\} 0$/m);
    });
  });
});
