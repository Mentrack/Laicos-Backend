import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FxConfig } from './fx.config';
import { FxController } from './fx.controller';
import { FX_QUEUE, FxProcessor, FxScheduler } from './fx.processor';
import { FxService } from './fx.service';

@Module({
  imports: [BullModule.registerQueue({ name: FX_QUEUE })],
  controllers: [FxController],
  providers: [FxConfig, FxService, FxProcessor, FxScheduler],
  exports: [FxService],
})
export class FxModule {}
