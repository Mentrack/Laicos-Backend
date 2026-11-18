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
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope, MessageResponseDto } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import { FarmerSourcingOfferDto, RejectSourcingOfferDto } from './dto';
import { FarmerSourcingOfferService } from './farmer-sourcing-offer.service';

@Controller('farmers/me/sourcing-offers')
@ApiTags('Sourcing Requests')
@Auth(Role.FARMER)
export class FarmerSourcingOfferController {
  constructor(private readonly offers: FarmerSourcingOfferService) {}

  @Get()
  @ApiOperation({
    summary: 'List the offers made to me',
    description:
      'Newest first, across all my farms. requestStatus lets the app hide offers on closed requests.',
  })
  @ApiEnvelope(FarmerSourcingOfferDto, { paginated: true })
  async findAll(@CurrentUser() user: User, @Query() query: PaginationQueryDto) {
    const { data, metaData } = await this.offers.findAll(user, query);
    return { data, message: 'Offers retrieved', metaData };
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an offer',
    description:
      'Only while the request is finding supply (409 SOURCING_OFFER_CLOSED otherwise). Accepting an accepted offer does nothing.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async accept(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.offers.accept(user, id);
    return { data: null, message: 'Offer accepted' };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject an offer',
    description:
      'Also allowed after accepting, when the farmer pulls out. Only while the request is finding supply.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async reject(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectSourcingOfferDto,
  ) {
    await this.offers.reject(user, id, dto);
    return { data: null, message: 'Offer rejected' };
  }
}
