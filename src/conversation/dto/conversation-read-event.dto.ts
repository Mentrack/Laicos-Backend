import { ApiProperty } from '@nestjs/swagger';

/** Payload of the `conversation.read` socket event. */
export class ConversationReadEventDto {
  @ApiProperty({ format: 'uuid' })
  conversationId: string;

  @ApiProperty({ format: 'uuid', description: 'Who read it' })
  userId: string;

  @ApiProperty()
  readAt: Date;
}
