import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageRecord } from './entities/usage-record.entity';
import { Receipt } from './entities/receipt.entity';
import { UsageRollup } from './entities/usage-rollup.entity';
import { MeteringService } from './metering.service';
import { MeteringRollupJob } from './metering-rollup.job';
import { MeteringController } from './metering.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UsageRecord, Receipt, UsageRollup])],
  controllers: [MeteringController],
  providers: [MeteringService, MeteringRollupJob],
  exports: [MeteringService, MeteringRollupJob],
})
export class MeteringModule {}
