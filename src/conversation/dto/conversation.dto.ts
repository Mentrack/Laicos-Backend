import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus, ProduceType, Role } from '../../../generated/client';
import { MessageDto } from './message.dto';

export class ConversationParticipantDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'Musa' })
  firstName: string;

  @ApiProperty({ example: 'Bello' })
  lastName: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role: Role;
}

export class ConversationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiProperty({ example: 'ORD-000123' })
  orderNumber: string;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus' })
  orderStatus: OrderStatus;

  @ApiProperty({ example: 'Cassava' })
  produceName: string;

  @ApiProperty({ example: 5 })
  quantity: number;

  @ApiProperty({
    example: 'tonnes',
    description: "The listing's current unit; orders don't snapshot it",
  })
  unit: string;

  @ApiProperty({ enum: ProduceType, enumName: 'ProduceType' })
  type: ProduceType;

  @ApiProperty({
    description:
      'The order is FULFILLED or CANCELLED: readable, but no new messages',
  })
  isClosed: boolean;

  @ApiProperty({ type: ConversationParticipantDto })
  counterpart: ConversationParticipantDto;

  @ApiProperty({ type: MessageDto, nullable: true })
  lastMessage: MessageDto | null;

  @ApiProperty({
    example: 2,
    description: 'Messages from the other side I have not read',
  })
  unreadCount: number;

  @ApiProperty({ type: Date, nullable: true })
  lastMessageAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}
