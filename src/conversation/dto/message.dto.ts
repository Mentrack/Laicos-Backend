import { ApiProperty } from '@nestjs/swagger';

export class MessageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  conversationId: string;

  @ApiProperty({ format: 'uuid', description: 'The sending user' })
  senderId: string;

  @ApiProperty({ example: 'Can the cassava be delivered in 50kg sacks?' })
  body: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Echoed back so the sending device can match its own send',
  })
  clientMessageId: string;

  @ApiProperty()
  createdAt: Date;
}
