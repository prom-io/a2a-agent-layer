import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
    ConfigModule.forRoot({
      isGlobal: true,
      load: [blockchainConfig],
    }),
    TypeOrmModule.forRootAsync(databaseConfig),
    BlockchainModule,
    IdentityModule,
    CatalogModule,
    PricingModule,
    MeteringModule,
    ProtocolModule,
    PolicyModule,
    HealthModule,
  ],
})
export class AppModule {}
