import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Agent } from '../../generated/client';
import {
  CurrentAgent,
  VerifiedAgent,
} from '../agent/decorators/verified-agent.decorator';
import { ApiEnvelope, MessageResponseDto } from '../common/dto/envelope';
import { IdempotencyKey, idempotencyKeyPipe } from '../common/idempotency-key';
import { PaginationQueryDto } from '../common/pagination';
import { AgentSourcingRequestService } from './agent-sourcing-request.service';
import {
  AgentFarmQueryDto,
  AgentSourcingRequestDto,
  ConfirmSourcingDto,
  DeclineSourcingRequestDto,
  PriceSourcingOfferDto,
  SetSourcingOffersDto,
  SIGN_CONTRACT_DESCRIPTION,
  SourcingContractDto,
  SourcingFarmRowDto,
  SourcingQuoteDto,
} from './dto';
import { SourcingContractService } from './sourcing-contract.service';

@Controller('agents/me/sourcing-requests')
@ApiTags('Sourcing Requests')
@VerifiedAgent()
export class AgentSourcingRequestController {
  constructor(
    private readonly requests: AgentSourcingRequestService,
    private readonly contracts: SourcingContractService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the buyer requests assigned to me',
    description: 'Newest first. Only requests currently assigned to me.',
  })
  @ApiEnvelope(AgentSourcingRequestDto, { paginated: true })
  async findAll(
    @CurrentAgent() agent: Agent,
    @Query() query: PaginationQueryDto,
  ) {
    const { data, metaData } = await this.requests.findAll(agent, query);
    return { data, message: 'Sourcing requests retrieved', metaData };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a buyer request assigned to me',
    description:
      'Includes the offers and the latest contract. Another agent’s request is 404, the same as a missing one.',
  })
  @ApiEnvelope(AgentSourcingRequestDto)
  async findOne(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.requests.findOne(agent, id);
    return { data, message: 'Sourcing request retrieved' };
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an assigned request',
    description:
      'Moves it to FINDING_SUPPLY and opens the chat with the buyer. 409 unless it is waiting for my answer.',
  })
  @ApiEnvelope(AgentSourcingRequestDto)
  async accept(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.requests.accept(agent, id);
    return { data, message: 'Sourcing request accepted' };
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline an assigned request',
    description:
      'Returns it to PENDING for an admin to reassign and tells the buyer. 409 unless it is waiting for my answer.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async decline(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineSourcingRequestDto,
  ) {
    await this.requests.decline(agent, id, dto);
    return { data: null, message: 'Sourcing request declined' };
  }

  @Get(':id/farms')
  @ApiOperation({
    summary: 'Search farms to offer',
    description:
      "Verified farms anywhere whose main produce, or any listing's name, contains the requested produce. Listing stock plays no part. A `search` replaces that filter and matches the farm name, farm code, farmer name, farmer code, main produce or listing names. State and LGA filters apply either way. `offerId` is this request's existing offer to the farm. 409 unless FINDING_SUPPLY.",
  })
  @ApiEnvelope(SourcingFarmRowDto, { paginated: true })
  async farms(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AgentFarmQueryDto,
  ) {
    const { data, metaData } = await this.requests.farms(agent, id, query);
    return { data, message: 'Farms retrieved', metaData };
  }

  @Put(':id/offers')
  @ApiOperation({
    summary: 'Replace the supply pool',
    description:
      "Sends the whole set of offers, one per farm, each a quantity in the farm's own unit. The unit must be comparable with the request's: kg and tonnes for a weight request, otherwise the same unit (400 SOURCING_UNIT_MISMATCH). New offers and changed quantities or units go to the farmer to accept again; offers left out are withdrawn and the farmer told. New and changed offers must be to a verified farm (409 SOURCING_FARM_UNVERIFIED); unchanged offers are not re-checked. No stock is checked. 409 unless FINDING_SUPPLY.",
  })
  @ApiEnvelope(AgentSourcingRequestDto)
  async setOffers(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSourcingOffersDto,
  ) {
    const data = await this.requests.setOffers(agent, id, dto);
    return { data, message: 'Offers updated' };
  }

  @Put(':id/offers/:offerId/price')
  @ApiOperation({
    summary: 'Set the agreed farmer price of an offer',
    description:
      "Per unit of the offer's own unit. Needs no farmer sign-off. 409 unless FINDING_SUPPLY.",
  })
  @ApiEnvelope(AgentSourcingRequestDto)
  async setOfferPrice(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: PriceSourcingOfferDto,
  ) {
    const data = await this.requests.setOfferPrice(agent, id, offerId, dto);
    return { data, message: 'Offer price set' };
  }

  @Post(':id/supply-complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark supply complete',
    description:
      'Moves FINDING_SUPPLY to NEGOTIATING. Accepted offers must cover the request (409 SOURCING_NOT_COVERED) and each have a price (409 SOURCING_UNPRICED); pending and rejected offers are ignored.',
  })
  @ApiEnvelope(AgentSourcingRequestDto)
  async supplyComplete(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.requests.supplyComplete(agent, id);
    return { data, message: 'Supply complete' };
  }

  @Post(':id/back')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step back a stage',
    description:
      'NEGOTIATING returns to FINDING_SUPPLY. CONFIRMED returns to NEGOTIATING and voids the contract, unless both parties have signed it (409 SOURCING_CONTRACT_SIGNED).',
  })
  @ApiEnvelope(AgentSourcingRequestDto)
  async back(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.requests.back(agent, id);
    return { data, message: 'Sourcing request moved back' };
  }

  @Get(':id/quote')
  @ApiOperation({
    summary: 'Get the suggested price',
    description:
      'Computed from the priced, accepted offers. The suggested price is the floor for the agreed price.',
  })
  @ApiEnvelope(SourcingQuoteDto)
  async quote(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.requests.quote(agent, id);
    return { data, message: 'Quote retrieved' };
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the deal and issue the contract',
    description:
      'Moves NEGOTIATING to CONFIRMED (409 SOURCING_NOT_NEGOTIATING otherwise) and tells the buyer the contract is ready. The accepted offers must still cover the request (409 SOURCING_NOT_COVERED) and every accepted farm still be verified (409 SOURCING_FARM_UNVERIFIED); either way nothing changes. No stock is checked. The agreed price must be at least the suggested price (409 SOURCING_PRICE_BELOW_FLOOR).',
  })
  @ApiEnvelope(SourcingContractDto)
  async confirm(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmSourcingDto,
  ) {
    const data = await this.contracts.confirm(agent, id, dto);
    return { data, message: 'Contract issued' };
  }

  @Get(':id/contract')
  @ApiOperation({
    summary: 'Get the contract',
    description: 'The latest one, which may be voided. 404 before confirm.',
  })
  @ApiEnvelope(SourcingContractDto)
  async contract(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.contracts.findOne(id, {
      role: 'AGENT',
      userId: agent.userId,
    });
    return { data, message: 'Contract retrieved' };
  }

  @Post(':id/contract/sign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign the contract',
    description: SIGN_CONTRACT_DESCRIPTION,
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiEnvelope(SourcingContractDto)
  async sign(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @IdempotencyKey(idempotencyKeyPipe()) idempotencyKey: string,
  ) {
    const data = await this.contracts.sign(
      id,
      { role: 'AGENT', userId: agent.userId },
      idempotencyKey,
    );
    return { data, message: 'Contract signed' };
  }
}
