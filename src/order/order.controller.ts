import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckoutDto } from '../cart/dto/checkout.dto';
import { ApiEnvelope } from '../common/dto/envelope';
import { IdempotencyKey, idempotencyKeyPipe } from '../common/idempotency-key';
import {
  CancelOrderDto,
  CreateOrderDto,
  OrderChecklistDto,
  OrderCountDto,
  OrderDto,
  OrderFilterDto,
  OrderQueryDto,
  OrderSummaryDto,
  UpdateOrderChecklistDto,
} from './dto';
import { OrderService } from './order.service';

@Controller('orders')
@ApiTags('Orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  @ApiOperation({
    summary: 'Buy Now',
    description:
      'Buyers only. Places one line as its own checkout, AWAITING_PAYMENT, without touching the cart; pay it with POST /checkouts/{id}/payments before expiresAt. 404 for listings the buyer cannot see, including those on unverified farms. Retrying with the same Idempotency-Key returns the original checkout.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A UUID the client generates once per attempt',
  })
  @Auth(Role.BUYER)
  @ApiEnvelope(CheckoutDto, { status: HttpStatus.CREATED })
  async create(
    @CurrentUser() user: User,
    @IdempotencyKey(idempotencyKeyPipe()) idempotencyKey: string,
    @Body() dto: CreateOrderDto,
  ) {
    const data = await this.orders.create(user, idempotencyKey, dto);
    return { data, message: 'Order placed' };
  }

  @Get()
  @ApiOperation({
    summary: 'List orders',
    description:
      'Buyers see orders they placed, farmers orders on their farms, admins everything.',
  })
  @Auth()
  @ApiEnvelope(OrderDto, { paginated: true })
  async findAll(@CurrentUser() user: User, @Query() query: OrderQueryDto) {
    const { data, metaData } = await this.orders.findAll(user, query);
    return { data, message: 'Orders retrieved', metaData };
  }

  // Declared before `:id`, or "count" would be routed to findOne and 400 on
  // ParseUUIDPipe.
  @Get('count')
  @ApiOperation({
    summary: 'Count orders by status',
    description: 'Every status is present, with zero where there are none.',
  })
  @Auth()
  @ApiEnvelope(OrderCountDto)
  async count(@CurrentUser() user: User, @Query() filter: OrderFilterDto) {
    const data = await this.orders.count(user, filter);
    return { data, message: 'Orders counted' };
  }

  // Dashboard cards. Declared before `:id` for the same reason as count.
  @Get('summary')
  @ApiOperation({ summary: 'Get my order dashboard figures' })
  @Auth(Role.FARMER)
  @ApiEnvelope(OrderSummaryDto)
  async summary(@CurrentUser() user: User) {
    const data = await this.orders.summary(user);
    return { data, message: 'Order summary retrieved' };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an order' })
  @Auth()
  @ApiEnvelope(OrderDto)
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orders.findOne(user, id);
    return { data, message: 'Order retrieved' };
  }

  // A farmer's moves are confirm -> prepare -> ready (or cancel), so each is
  // its own route rather than a free-form status PATCH.
  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Confirm a pending order' })
  @Auth(Role.FARMER, Role.ADMIN)
  @ApiEnvelope(OrderDto)
  async confirm(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orders.confirm(user, id);
    return { data, message: 'Order confirmed' };
  }

  @Patch(':id/prepare')
  @ApiOperation({
    summary: 'Start preparing a confirmed order',
    description: 'Creates the order’s preparation checklist.',
  })
  @Auth(Role.FARMER, Role.ADMIN)
  @ApiEnvelope(OrderDto)
  async prepare(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orders.prepare(user, id);
    return { data, message: 'Order preparation started' };
  }

  @Get(':id/checklist')
  @ApiOperation({ summary: 'Get an order’s preparation checklist' })
  @Auth(Role.FARMER, Role.ADMIN)
  @ApiEnvelope(OrderChecklistDto)
  async findChecklist(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orders.findChecklist(user, id);
    return { data, message: 'Checklist retrieved' };
  }

  @Patch(':id/checklist')
  @ApiOperation({ summary: 'Tick items on an order’s preparation checklist' })
  @Auth(Role.FARMER, Role.ADMIN)
  @ApiEnvelope(OrderChecklistDto)
  async updateChecklist(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderChecklistDto,
  ) {
    const data = await this.orders.updateChecklist(user, id, dto);
    return { data, message: 'Checklist updated' };
  }

  @Patch(':id/ready')
  @ApiOperation({
    summary: 'Mark a prepared order ready',
    description: 'Needs every checklist item ticked.',
  })
  @Auth(Role.FARMER, Role.ADMIN)
  @ApiEnvelope(OrderDto)
  async markReady(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orders.markReady(user, id);
    return { data, message: 'Order marked ready' };
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel an order',
    description:
      'Farmers can cancel until the order is ready; buyers only before it is confirmed. A reason is required.',
  })
  @Auth()
  @ApiEnvelope(OrderDto)
  async cancel(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    const data = await this.orders.cancel(user, id, dto);
    return { data, message: 'Order cancelled' };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete my pending order',
    description:
      'Buyers only, and only a legacy order placed without a checkout while it is still PENDING; a paid order (409 ORDER_PAID) or one past PENDING must be cancelled instead.',
  })
  @Auth(Role.BUYER)
  @ApiEnvelope(OrderDto)
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orders.remove(user, id);
    return { data, message: 'Order deleted' };
  }
}
