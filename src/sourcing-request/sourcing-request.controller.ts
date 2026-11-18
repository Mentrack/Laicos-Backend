import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { IdempotencyKey, idempotencyKeyPipe } from '../common/idempotency-key';
import { PaginationQueryDto } from '../common/pagination';
import {
  CreateSourcingRequestDto,
  SIGN_CONTRACT_DESCRIPTION,
  SourcingContractDto,
  SourcingRequestDto,
} from './dto';
import { SourcingContractService } from './sourcing-contract.service';
import { SourcingRequestService } from './sourcing-request.service';

@Controller('sourcing-requests')
@ApiTags('Sourcing Requests')
@Auth(Role.BUYER)
export class SourcingRequestController {
  constructor(
    private readonly sourcingRequests: SourcingRequestService,
    private readonly contracts: SourcingContractService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Request produce that is not listed',
    description: 'Starts PENDING until an admin assigns an agent.',
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
  @ApiOperation({
    summary: 'List my sourcing requests',
    description: "Only the caller's own, newest first.",
  })
  @ApiEnvelope(SourcingRequestDto, { paginated: true })
  async findAll(@CurrentUser() user: User, @Query() query: PaginationQueryDto) {
    const { data, metaData } = await this.sourcingRequests.findAll(user, query);
    return { data, message: 'Sourcing requests retrieved', metaData };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one of my sourcing requests',
    description: "Another buyer's request is 404, the same as a missing one.",
  })
  @ApiEnvelope(SourcingRequestDto)
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.sourcingRequests.findOne(user, id);
    return { data, message: 'Sourcing request retrieved' };
  }

  @Get(':id/contract')
  @ApiOperation({
    summary: 'Get the contract for one of my requests',
    description:
      'The latest one, which may be voided. 404 before the agent confirms, and for another buyer’s request.',
  })
  @ApiEnvelope(SourcingContractDto)
  async contract(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.contracts.findOne(id, {
      role: 'BUYER',
      userId: user.id,
    });
    return { data, message: 'Contract retrieved' };
  }

  @Post(':id/contract/sign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign the contract for one of my requests',
    description: SIGN_CONTRACT_DESCRIPTION,
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiEnvelope(SourcingContractDto)
  async sign(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @IdempotencyKey(idempotencyKeyPipe()) idempotencyKey: string,
  ) {
    const data = await this.contracts.sign(
      id,
      { role: 'BUYER', userId: user.id },
      idempotencyKey,
    );
    return { data, message: 'Contract signed' };
  }
}
