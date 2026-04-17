import { Module } from '@nestjs/common';
import { ProtocolService } from './protocol.service';
import { ProtocolController } from './protocol.controller';
import { MeteringModule } from '../metering/metering.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [MeteringModule, IdentityModule],
  controllers: [ProtocolController],
  providers: [ProtocolService],
  exports: [ProtocolService],
})
export class ProtocolModule {}
