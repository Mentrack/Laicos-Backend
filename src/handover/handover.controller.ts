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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Agent } from '../../generated/client';
import {
  CurrentAgent,
  VerifiedAgent,
} from '../agent/decorators/verified-agent.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import {
  CompleteHandoverDto,
  HandoverDto,
  HandoverQueryDto,
  VerifyHandoverDto,
} from './dto';
import { HandoverService } from './handover.service';

// Keyed by order id: a handover is one-to-one with its order.
@Controller('handovers')
@ApiTags('Handovers')
@VerifiedAgent()
export class HandoverController {
  constructor(private readonly handovers: HandoverService) {}

  @Get()
  @ApiOperation({
    summary: 'List my order handovers',
    description:
      'READY orders from my cluster. Filter by status, e.g. PENDING for orders still to verify.',
  })
  @ApiEnvelope(HandoverDto, { paginated: true })
  async findAll(
    @CurrentAgent() agent: Agent,
    @Query() query: HandoverQueryDto,
  ) {
    const { data, metaData } = await this.handovers.findAll(agent, query);
    return { data, message: 'Handovers retrieved', metaData };
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Get an order handover' })
  @ApiEnvelope(HandoverDto)
  async findOne(
    @CurrentAgent() agent: Agent,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const data = await this.handovers.findOne(agent, orderId);
    return { data, message: 'Handover retrieved' };
  }

  @Post(':orderId/verify')
  @ApiOperation({
    summary: 'Verify the order’s goods',
    description: 'PENDING -> VERIFIED, after checking the goods at the farm.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(HandoverDto)
  async verify(
    @CurrentAgent() agent: Agent,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: VerifyHandoverDto,
  ) {
    const data = await this.handovers.verify(agent, orderId, dto);
    return { data, message: 'Order verified' };
  }

  @Post(':orderId/complete')
  @ApiOperation({
    summary: 'Hand the order over to logistics',
    description:
      'VERIFIED -> HANDED_OVER, recording who took the goods. The order becomes SHIPPED.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(HandoverDto)
  async complete(
    @CurrentAgent() agent: Agent,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CompleteHandoverDto,
  ) {
    const data = await this.handovers.complete(agent, orderId, dto);
    return { data, message: 'Order handed over' };
  }
}
