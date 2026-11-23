// Suites built on this helper send far more than ten requests a second from
// one address. The limits are read when AppModule is loaded, so they are
// raised here, before the import below is evaluated, and every suite must
// import this helper before anything that pulls in AppModule. Rate limiting
// itself is covered by security.e2e-spec.ts with the default limits.
process.env.THROTTLE_SHORT_LIMIT = '1000';
process.env.THROTTLE_LONG_LIMIT = '10000';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-secret';
process.env.CSRF_SECRET = process.env.CSRF_SECRET ?? 'e2e-csrf-secret';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ethers } from 'ethers';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Role } from '../../src/common/auth/roles.enum';
import { SanitizePipe } from '../../src/common/pipes/sanitize.pipe';
import { buildRegistrationMessage } from '../../src/modules/identity/did-controller';

export interface E2eApp {
  app: INestApplication;
  moduleRef: TestingModule;
  http: () => ReturnType<typeof request>;
  /** `Bearer <jwt>` for a caller with the given role. */
  bearer: (role: Role, sub?: string) => string;
  close: () => Promise<void>;
}

/** Boots the whole application on a random port, configured like main.ts. */
export async function createE2eApp(): Promise<E2eApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new SanitizePipe(),
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // listen(0) binds once on a random port; with init() alone every parallel
  // supertest call would try to bring the server up itself.
  await app.listen(0);
  const jwt = app.get(JwtService);

  return {
    app,
    moduleRef,
    http: () => request(app.getHttpServer()),
    bearer: (role, sub = `e2e-${role}`) =>
      `Bearer ${jwt.sign({ sub, did: `did:prom:${sub}`, role })}`,
    close: () => app.close(),
  };
}

/** Unique per run so a suite can be repeated against the same database. */
export const runId = (): string =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Registers an agent through the API with a valid ownership proof. */
export async function registerAgent(
  e2e: E2eApp,
  agentDid: string,
): Promise<{ id: string; agentDid: string; owner: ethers.HDNodeWallet }> {
  const owner = ethers.Wallet.createRandom();
  const claim = {
    agentDid,
    owner: owner.address,
    publicKey: '0x04abcdef',
    endpoint: 'http://test-agent:8080',
  };
  const res = await e2e
    .http()
    .post('/agents')
    .set('Authorization', e2e.bearer(Role.OPERATOR))
    .send({ ...claim, ownerSignature: await owner.signMessage(buildRegistrationMessage(claim)) })
    .expect(201);
  return { id: res.body.id, agentDid, owner };
}
