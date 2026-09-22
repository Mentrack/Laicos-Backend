import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProduceController } from './produce.controller';
import { ProduceService } from './produce.service';

@Module({
  imports: [AuthModule],
  controllers: [ProduceController],
  providers: [ProduceService],
})
export class ProduceModule {}
