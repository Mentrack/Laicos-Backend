import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayoutConfig } from '../payout/payout.config';
import { ChatGateway } from './chat.gateway';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';

@Module({
  imports: [AuthModule],
  controllers: [ConversationController],
  providers: [ConversationService, ChatGateway, PayoutConfig],
})
export class ConversationModule {}
