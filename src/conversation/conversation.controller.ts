import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import { ConversationService } from './conversation.service';
import {
  ConversationDto,
  MessageDto,
  MessageQueryDto,
  SendMessageDto,
} from './dto';

@Controller()
@ApiTags('Messages')
@Auth(Role.BUYER, Role.EXTENSION_AGENT)
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Post('orders/:orderId/conversation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open the conversation for an order',
    description:
      "Between the order's buyer and its agent (the handover agent once READY, else the farm's cluster agent). Returns the existing conversation if there is one. 403 NOT_A_PARTICIPANT; 409 CONVERSATION_NOT_OPEN while unpaid, NO_AGENT_ASSIGNED when the farm is in no cluster, CONVERSATION_CLOSED when the order is already fulfilled or cancelled.",
  })
  @ApiEnvelope(ConversationDto)
  async open(
    @CurrentUser() user: User,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const data = await this.conversations.open(user, orderId);
    return { data, message: 'Conversation opened' };
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'List my conversations',
    description: 'Most recent message first; threads with no messages last.',
  })
  @ApiEnvelope(ConversationDto, { paginated: true })
  async findAll(@CurrentUser() user: User, @Query() query: PaginationQueryDto) {
    const { data, metaData } = await this.conversations.findAll(user, query);
    return { data, message: 'Conversations retrieved', metaData };
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get a conversation' })
  @ApiEnvelope(ConversationDto)
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.conversations.findOne(user, id);
    return { data, message: 'Conversation retrieved' };
  }

  @Get('conversations/:id/messages')
  @ApiOperation({
    summary: 'List messages in a conversation',
    description:
      'Oldest first. Without a cursor, the newest page. before pages back through history; after catches up after a reconnect. 400 INVALID_CURSOR for both cursors at once or a message from another conversation.',
  })
  @ApiEnvelope(MessageDto, { list: true })
  async listMessages(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessageQueryDto,
  ) {
    const data = await this.conversations.listMessages(user, id, query);
    return { data, message: 'Messages retrieved' };
  }

  @Post('conversations/:id/messages')
  @ApiOperation({
    summary: 'Send a message',
    description:
      'Both participants also get it as the message.created socket event. Retrying with the same clientMessageId returns the original. 409 CONVERSATION_CLOSED once the order is fulfilled or cancelled; 409 CLIENT_MESSAGE_ID_REUSED if the clientMessageId was used in another conversation.',
  })
  @ApiEnvelope(MessageDto, { status: HttpStatus.CREATED })
  async send(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    const data = await this.conversations.send(user, id, dto);
    return { data, message: 'Message sent' };
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a conversation read',
    description:
      'Clears my unread count. Both participants get the conversation.read socket event.',
  })
  @ApiEnvelope(ConversationDto)
  async markRead(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.conversations.markRead(user, id);
    return { data, message: 'Conversation marked read' };
  }
}
