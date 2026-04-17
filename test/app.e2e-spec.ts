import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Agent Layer (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
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
});
