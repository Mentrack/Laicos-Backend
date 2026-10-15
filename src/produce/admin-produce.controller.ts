import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import {
  AdminProduceActionDto,
  AdminProduceQueryDto,
  AdminProduceRowDto,
  AdminProduceSummaryDto,
} from './dto/admin-produce.dto';
import { AdminProduceService } from './admin-produce.service';

@Controller('admin/farms/:farmId/produce')
@ApiTags('Produce')
@Auth(Role.ADMIN)
export class AdminFarmProduceController {
  constructor(private readonly produce: AdminProduceService) {}

  @Get()
  @ApiOperation({
    summary: 'List a farm’s produce',
    description:
      '{farmId} is Farm.id. Same rows as GET /admin/produce, limited to that farm, including drafts. Search, category and status still filter. 404 when the farm does not exist. An empty page when it has no listings.',
  })
  @ApiEnvelope(AdminProduceRowDto, { paginated: true })
  async findByFarm(
    @Param('farmId', ParseUUIDPipe) farmId: string,
    @Query() query: AdminProduceQueryDto,
  ) {
    const { data, metaData } = await this.produce.findByFarm(farmId, query);
    return { data, message: 'Produce retrieved', metaData };
  }
}

@Controller('admin/produce')
@ApiTags('Produce')
@Auth(Role.ADMIN)
export class AdminProduceController {
  constructor(private readonly produce: AdminProduceService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Count the produce catalogue',
    description:
      'The cards above the table. Not affected by the table search or filters. activeListings is PUBLISHED plus SOLD_OUT. inactiveListings is DRAFT plus DISABLED. availableStockKg sums floatingQuantity where the unit is kg; other units are left out. recentListings were created in the last 7 days.',
  })
  @ApiEnvelope(AdminProduceSummaryDto)
  async summary() {
    const data = await this.produce.summary();
    return { data, message: 'Produce summary retrieved' };
  }

  @Get()
  @ApiOperation({
    summary: 'List every produce listing',
    description:
      'Newest first, including drafts and listings on farms that are not verified. Search matches the product name, farm name or farm code. Filter with category and status.',
  })
  @ApiEnvelope(AdminProduceRowDto, { paginated: true })
  async findAll(@Query() query: AdminProduceQueryDto) {
    const { data, metaData } = await this.produce.findAll(query);
    return { data, message: 'Produce retrieved', metaData };
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disable a listing',
    description:
      'Sets the listing to DISABLED, which takes it off the shop. 409 when it has an order in PENDING, CONFIRMED, PREPARING, READY or SHIPPED. 404 when the listing does not exist. A farmer edit cannot publish it again.',
  })
  @ApiEnvelope(AdminProduceActionDto)
  async disable(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.produce.disable(id);
    return { data, message: 'Produce disabled' };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Remove a disabled listing',
    description:
      'Deletes a DISABLED listing. 409 when it is not disabled, or when it already has orders. 404 when the listing does not exist.',
  })
  @ApiEnvelope(AdminProduceActionDto)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.produce.remove(id);
    return { data, message: 'Produce deleted' };
  }
}
