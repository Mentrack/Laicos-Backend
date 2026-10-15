import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import {
  AdminFarmDetailDto,
  AdminFarmQueryDto,
  AdminFarmRowDto,
  AdminFarmSummaryDto,
} from './dto';
import { AdminFarmService } from './services/admin-farm.service';

@Controller('admin/farms')
@ApiTags('Farms')
@Auth(Role.ADMIN)
export class AdminFarmController {
  constructor(private readonly farms: AdminFarmService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Count the farmers directory',
    description:
      'The cards above the list. Not affected by the list search or filters. verificationRate is the nearest percent of farms that are VERIFIED, or 0 when there are no farms. REJECTED farms are in the rate and in none of the status cards.',
  })
  @ApiEnvelope(AdminFarmSummaryDto)
  async summary() {
    const data = await this.farms.summary();
    return { data, message: 'Farm summary retrieved' };
  }

  @Get()
  @ApiOperation({
    summary: 'List farms',
    description:
      'One row per farm, newest first. Search matches the farmer name, phone, farmer code, farm code or farm name. Filter with stateId and status. Documents are on GET /admin/farms/{id}.',
  })
  @ApiEnvelope(AdminFarmRowDto, { paginated: true })
  async findAll(@Query() query: AdminFarmQueryDto) {
    const { data, metaData } = await this.farms.findAll(query);
    return { data, message: 'Farms retrieved', metaData };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a farm',
    description:
      '{id} is the Farm id. The farmer is the page header. Includes listings, sale totals, the five newest sales, the supply cluster, each round’s expected documents and evidence status, issue photos, every verification round and the cluster agent. Document and evidence links expire in 15 minutes. 404 when the farm does not exist.',
  })
  @ApiEnvelope(AdminFarmDetailDto)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.farms.findOne(id);
    return { data, message: 'Farm retrieved' };
  }
}
