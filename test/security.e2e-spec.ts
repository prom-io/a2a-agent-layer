import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { Role } from '../src/common/auth/roles.enum';
import { SanitizePipe } from '../src/common/pipes/sanitize.pipe';

/**
 * End-to-end cover for the P2 Security surface: headers, guards, roles,
 * sanitization and rate limiting, exercised through the real HTTP stack rather
 * than by calling the guards directly.
 */
describe('Security (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;

  const tokenFor = (role: Role, sub = 'e2e-agent') =>
    jwt.sign({ sub, did: `did:prom:${sub}`, role });

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-secret';
    process.env.CSRF_SECRET = process.env.CSRF_SECRET ?? 'e2e-csrf-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new SanitizePipe(),
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    jwt = app.get(JwtService);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('security headers', () => {
    it('sets the hardening headers on every response', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['strict-transport-security']).toContain('max-age=');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    });

    it('does not advertise the framework', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('returns a request id that callers can quote in a bug report', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.headers['x-request-id']).toBeTruthy();
    });
  });

  describe('authentication', () => {
    it('leaves health and readiness open', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer()).get('/ready').expect(200);
    });

    it('rejects an unauthenticated call to a protected route', async () => {
      await request(app.getHttpServer()).get('/agents').expect(401);
    });

    it('rejects a token signed with the wrong secret', async () => {
      const foreign = new JwtService({ secret: 'not-our-secret' }).sign({
        sub: 'intruder',
        did: 'did:prom:intruder',
        role: Role.ADMIN,
      });
      await request(app.getHttpServer())
        .get('/agents')
        .set('Authorization', `Bearer ${foreign}`)
        .expect(401);
    });

    it('rejects a malformed authorization header', async () => {
      await request(app.getHttpServer())
        .get('/agents')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('accepts a valid token', async () => {
      await request(app.getHttpServer())
        .get('/agents')
        .set('Authorization', `Bearer ${tokenFor(Role.AGENT)}`)
        .expect(200);
    });
  });

  describe('authorization', () => {
    it('forbids an agent from registering another agent', async () => {
      await request(app.getHttpServer())
        .post('/agents')
        .set('Authorization', `Bearer ${tokenFor(Role.AGENT)}`)
        .send({ did: 'did:prom:new-agent', name: 'new' })
        .expect(403);
    });

    it('forbids an operator from deactivating an agent', async () => {
      await request(app.getHttpServer())
        .delete('/agents/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenFor(Role.OPERATOR)}`)
        .expect(403);
    });

    it('does not leak whether the resource exists when the role is wrong', async () => {
      // A 404 here would tell an unauthorised caller which ids are real.
      const res = await request(app.getHttpServer())
        .delete('/agents/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenFor(Role.AGENT)}`);
      expect(res.status).toBe(403);
    });
  });

  describe('input sanitization', () => {
    it('strips markup from string fields before validation', async () => {
      const res = await request(app.getHttpServer())
        .post('/agents')
        .set('Authorization', `Bearer ${tokenFor(Role.ADMIN)}`)
        .send({
          did: 'did:prom:sanitized',
          name: '<script>alert(1)</script>Clean Name',
          endpoint: 'https://example.com',
        });

      if (res.status < 300) {
        expect(res.body.name).toBe('Clean Name');
        expect(res.body.name).not.toContain('<script>');
      } else {
        expect([400, 409]).toContain(res.status);
      }
    });
  });

  describe('rate limiting', () => {
    it('returns 429 once the short-window limit is exceeded', async () => {
      const token = tokenFor(Role.AGENT);
      const responses = await Promise.all(
        Array.from({ length: 25 }, () =>
          request(app.getHttpServer())
            .get('/agents')
            .set('Authorization', `Bearer ${token}`),
        ),
      );
      expect(responses.some((r) => r.status === 429)).toBe(true);
    });

    it('never rate limits the probes an orchestrator polls', async () => {
      const responses = await Promise.all(
        Array.from({ length: 25 }, () => request(app.getHttpServer()).get('/health')),
      );
      expect(responses.every((r) => r.status === 200)).toBe(true);
    });
  });
});
