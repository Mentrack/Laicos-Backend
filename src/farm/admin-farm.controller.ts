import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { csvFile } from '../common/csv';
import { ApiEnvelope } from '../common/dto/envelope';
import {
  AdminFarmDetailDto,
  AdminFarmFilterDto,
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

  // Declared before any ':id' route so 'export' is not read as an id.
  // Returns the raw CSV text, not the response envelope.
  @Get('export')
  @ApiOperation({
    summary: 'Export farms as CSV',
    description:
      'Every farm matching the list filters (search, stateId, status, sort), without pagination.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string' } })
  exportCsv(@Query() filter: AdminFarmFilterDto) {
    return csvFile(this.farms.exportCsv(filter), 'farms.csv');
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
      '{id} is the Farm id. The farmer is the page header, with their ID type, number and a 15-minute link to the ID document. Includes listings, sale totals, the five newest sales, the supply cluster, each round’s expected documents and evidence status, issue photos, every verification round and the cluster agent. Document and evidence links expire in 15 minutes. 404 when the farm does not exist.',
  })
  @ApiEnvelope(AdminFarmDetailDto)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.farms.findOne(id);
    return { data, message: 'Farm retrieved' };
  }
}
