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
import { ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import {
  CancelOrderDto,
  CreateOrderDto,
  OrderCountDto,
  OrderDto,
  OrderFilterDto,
  OrderQueryDto,
} from './dto';
import { OrderService } from './order.service';

@Controller('orders')
@ApiTags('Orders')
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  @Auth(Role.BUYER)
  @ApiEnvelope(OrderDto, { status: HttpStatus.CREATED })
  async create(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    const data = await this.orders.create(user, dto);
    return { data, message: 'Order placed' };
  }

  @Get()
  @Auth()
  @ApiEnvelope(OrderDto, { paginated: true })
  async findAll(@CurrentUser() user: User, @Query() query: OrderQueryDto) {
    const { data, metaData } = await this.orders.findAll(user, query);
    return { data, message: 'Orders retrieved', metaData };
  }

  // Declared before `:id`, or "count" would be routed to findOne and 400 on
  // ParseUUIDPipe.
  @Get('count')
  @Auth()
  @ApiEnvelope(OrderCountDto)
  async count(@CurrentUser() user: User, @Query() filter: OrderFilterDto) {
    const data = await this.orders.count(user, filter);
    return { data, message: 'Orders counted' };
  }

  @Get(':id')
  @Auth()
  @ApiEnvelope(OrderDto)
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orders.findOne(user, id);
    return { data, message: 'Order retrieved' };
  }

  // A farmer's only moves are confirm and cancel, so each is its own route
  // rather than a free-form status PATCH.
  @Patch(':id/confirm')
  @Auth(Role.FARMER, Role.ADMIN)
  @ApiEnvelope(OrderDto)
  async confirm(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orders.confirm(user, id);
    return { data, message: 'Order confirmed' };
  }

  @Patch(':id/ready')
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
