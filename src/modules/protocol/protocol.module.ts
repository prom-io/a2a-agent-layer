import { Module } from '@nestjs/common';
import { ProtocolService } from './protocol.service';
import { ProtocolController } from './protocol.controller';
import { NonceStoreService } from './nonce-store.service';
import { MeteringModule } from '../metering/metering.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [MeteringModule, IdentityModule],
  controllers: [ProtocolController],
  providers: [ProtocolService, NonceStoreService],
  exports: [ProtocolService],
})
export class ProtocolModule {}
