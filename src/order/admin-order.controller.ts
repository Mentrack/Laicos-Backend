import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { AuditEventDto } from '../audit/dto/audit-event.dto';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import { AdminOrderService } from './admin-order.service';
import {
  AdminOrderCountsDto,
  AdminOrderDetailDto,
  AdminOrderExportQueryDto,
  AdminOrderFilterDto,
  AdminOrderQueryDto,
  AdminOrderRowDto,
} from './dto';

@Controller('admin/orders')
@ApiTags('Orders')
@Auth(Role.ADMIN)
export class AdminOrderController {
  constructor(private readonly orders: AdminOrderService) {}

  // Declared before any ':id' route so 'counts' is not read as an id.
  @Get('counts')
  @ApiOperation({
    summary: 'Count orders per tab',
    description:
      'The numbers on the tab strip. Takes the list filters (status, produceId, search, from, to) but not tab, page or sort, so each tab shows how many rows it would list.',
  })
  @ApiEnvelope(AdminOrderCountsDto)
  async counts(@Query() filter: AdminOrderFilterDto) {
    const data = await this.orders.counts(filter);
    return { data, message: 'Order counts retrieved' };
  }

  // Declared before any ':id' route so 'export' is not read as an id.
  // Returns the raw CSV text, not the response envelope.
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="orders.csv"')
  @ApiOperation({
    summary: 'Export orders as CSV',
    description:
      'Every order matching the list filters (status, produceId, search, from, to, tab, sort), without pagination.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string' } })
  exportCsv(@Query() query: AdminOrderExportQueryDto) {
    return this.orders.exportCsv(query);
  }

  @Get()
  @ApiOperation({
    summary: 'List orders',
    description:
      'One row per order, newest first unless sort=asc. tab narrows by status group and is ANDed with status. from and to are Lagos calendar dates, both inclusive; 400 when from is after to.',
  })
  @ApiEnvelope(AdminOrderRowDto, { paginated: true })
  async findAll(@Query() query: AdminOrderQueryDto) {
    const { data, metaData } = await this.orders.findAll(query);
    return { data, message: 'Orders retrieved', metaData };
  }

  @Get(':id/timeline')
  @ApiOperation({
    summary: 'List the audit timeline of an order',
    description: 'Newest first. 404 when the order is missing.',
  })
  @ApiEnvelope(AuditEventDto, { paginated: true })
  async timeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    const { data, metaData } = await this.orders.timeline(id, query);
    return { data, message: 'Order timeline retrieved', metaData };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get an order',
    description:
      'The order with its buyer, farm, payment, buyer request and dispute. 404 when it is missing.',
  })
  @ApiEnvelope(AdminOrderDetailDto)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.orders.findOne(id);
    return { data, message: 'Order retrieved' };
  }
}
