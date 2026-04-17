import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageRecord } from './entities/usage-record.entity';
import { Receipt } from './entities/receipt.entity';
import { MeteringService } from './metering.service';
import { MeteringController } from './metering.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UsageRecord, Receipt])],
  controllers: [MeteringController],
  providers: [MeteringService],
  exports: [MeteringService],
})
export class MeteringModule {}
