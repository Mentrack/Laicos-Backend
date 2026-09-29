import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope } from '../common/dto/envelope';
import { LgaDto, StateDto } from './dto';
import { LocationService } from './location.service';

// Public reference data for the location dropdowns, so no @Auth. Unpaginated:
// 37 states, and at most 44 LGAs in a state.
@Controller('locations')
@ApiTags('Locations')
export class LocationController {
  constructor(private readonly locations: LocationService) {}

  @Get('states')
  @ApiOperation({ summary: 'List all states' })
  @ApiEnvelope(StateDto, { list: true })
  async findStates() {
    const data = await this.locations.findStates();
    return { data, message: 'States retrieved' };
  }

  @Get('states/:stateId/lgas')
  @ApiOperation({ summary: 'List the LGAs in a state' })
  @ApiEnvelope(LgaDto, { list: true })
  async findLgas(@Param('stateId', ParseUUIDPipe) stateId: string) {
    const data = await this.locations.findLgas(stateId);
    return { data, message: 'LGAs retrieved' };
  }
}
