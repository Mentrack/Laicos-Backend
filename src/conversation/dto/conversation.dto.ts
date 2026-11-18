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

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Set for an order chat; null for a sourcing chat',
  })
  orderId: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description:
      "Set for a sourcing chat, which also serves the request's orders",
  })
  sourcingRequestId: string | null;

  @ApiProperty({ example: 'ORD-000123', nullable: true })
  orderNumber: string | null;

  @ApiProperty({ enum: OrderStatus, enumName: 'OrderStatus', nullable: true })
  orderStatus: OrderStatus | null;

  @ApiProperty({ example: 'Cassava' })
  produceName: string;

  @ApiProperty({ example: 5 })
  quantity: number;

  @ApiProperty({
    example: 'tonnes',
    description:
      "An order chat shows the listing's current unit (orders don't snapshot it); a sourcing chat the request's SourcingUnit",
  })
  unit: string;

  @ApiProperty({ enum: ProduceType, enumName: 'ProduceType', nullable: true })
  type: ProduceType | null;

  @ApiProperty({
    description:
      'Readable, but no new messages. An order chat closes when the order is cancelled, or fulfilled with its dispute window passed and no open dispute. A sourcing chat closes when the request is CLOSED before payment, or once every paid order is closed that way.',
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
