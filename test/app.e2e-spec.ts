import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { MeteringRollupJob } from '../src/modules/metering/metering-rollup.job';
import { hashCanonicalRequest } from '../src/common/crypto/request-canonicalization';

describe('Agent Layer (e2e)', () => {
  let app: INestApplication;
  let rollupJob: MeteringRollupJob;

  const buildA2aBody = (overrides: Record<string, unknown> = {}) => {
    const base = {
      agentFromId: 'did:prom:e2e-caller',
      agentToId: 'did:prom:e2e-target',
      sessionId: 'e2e-session-001',
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    rollupJob = moduleFixture.get(MeteringRollupJob);
  });

  afterAll(async () => {
    await app.close();
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
  });

  describe('/agents (POST)', () => {
    it('should register a new agent', () => {
      return request(app.getHttpServer())
        .post('/agents')
        .send({
          agentDid: 'did:prom:test-agent-1',
          owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
          publicKey: '0x04abcdef',
          endpoint: 'http://test-agent:8080',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.id).toBeDefined();
          expect(res.body.agentDid).toBe('did:prom:test-agent-1');
          expect(res.body.status).toBe('active');
        });
    });

    it('should reject invalid body', () => {
      return request(app.getHttpServer())
        .post('/agents')
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
        .expect(404);
    });
  });

  describe('/a2a/request (POST)', () => {
    it('rejects replayed nonces with 409', async () => {
      const body = buildA2aBody({ nonce: 'e2e-nonce-replay-1', sessionId: 'e2e-replay-session' });
      await request(app.getHttpServer()).post('/a2a/request').send(body).expect(201);
      await request(app.getHttpServer()).post('/a2a/request').send(body).expect(409);
    });

    it('returns 403 when policy denies the caller subject', async () => {
      const targetAgentId = 'did:prom:e2e-policy-target';
      await request(app.getHttpServer())
        .post('/policies')
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
        sessionId: 'e2e-policy-deny-session',
        nonce: 'e2e-nonce-policy-1',
      });

      await request(app.getHttpServer()).post('/a2a/request').send(body).expect(403);
    });
  });

  describe('metering rollup job', () => {
    it('runs idempotently for the same hour bucket', async () => {
      const ref = new Date();
      const first = await rollupJob.runHourlyRollup(ref);
      const second = await rollupJob.runHourlyRollup(ref);
      expect(second).toBe(first);
    });
  });
});
