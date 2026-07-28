import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppMiddlewareModule } from './app.middleware.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { throttlerConfigFactory } from './config/throttler.config';
import { AuthModule } from './common/auth/auth.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { databaseConfig } from './config/database.config';
import { blockchainConfig } from './config/blockchain.config';
import { BlockchainModule } from './common/blockchain/blockchain.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { MeteringModule } from './modules/metering/metering.module';
import { ProtocolModule } from './modules/protocol/protocol.module';
import { PolicyModule } from './modules/policy/policy.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    AppMiddlewareModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [blockchainConfig],
    }),
    TypeOrmModule.forRootAsync(databaseConfig),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: throttlerConfigFactory,
    }),
    AuthModule,
    BlockchainModule,
    IdentityModule,
    CatalogModule,
    PricingModule,
    MeteringModule,
    ProtocolModule,
    PolicyModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
