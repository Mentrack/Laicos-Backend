import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import { CreateSourcingRequestDto, SourcingRequestDto } from './dto';
import { SourcingRequestService } from './sourcing-request.service';

@Controller('sourcing-requests')
@ApiTags('Sourcing Requests')
@Auth(Role.BUYER)
export class SourcingRequestController {
  constructor(private readonly sourcingRequests: SourcingRequestService) {}

  @Post()
  @ApiOperation({
    summary: 'Request produce that is not listed',
    description: 'Starts UNDER_REVIEW while LAICOS matches it with providers.',
  })
  @ApiEnvelope(SourcingRequestDto, { status: HttpStatus.CREATED })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateSourcingRequestDto,
  ) {
    const data = await this.sourcingRequests.create(user, dto);
    return { data, message: 'Sourcing request submitted' };
  }

  @Get()
  @ApiOperation({ summary: 'List my sourcing requests' })
  @ApiEnvelope(SourcingRequestDto, { paginated: true })
  async findAll(@CurrentUser() user: User, @Query() query: PaginationQueryDto) {
    const { data, metaData } = await this.sourcingRequests.findAll(user, query);
    return { data, message: 'Sourcing requests retrieved', metaData };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my sourcing requests' })
  @ApiEnvelope(SourcingRequestDto)
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.sourcingRequests.findOne(user, id);
    return { data, message: 'Sourcing request retrieved' };
  }
}
