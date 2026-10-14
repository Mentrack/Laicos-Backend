import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { BuyerService } from './buyer.service';
import { BuyerDto, BuyerProfileDto, UpdateBuyerDto } from './dto';

@Controller('buyers')
@ApiTags('Buyers')
export class BuyerController {
  constructor(private readonly buyers: BuyerService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get my buyer profile',
    description:
      'Includes my public code and home location, if I have set one.',
  })
  @Auth(Role.BUYER)
  @ApiEnvelope(BuyerProfileDto)
  async findMine(@CurrentUser() user: User) {
    const data = await this.buyers.findMine(user);
    return { data, message: 'Buyer profile retrieved' };
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Set my home location',
    description: 'Send stateId and lgaId together.',
  })
  @Auth(Role.BUYER)
  @ApiEnvelope(BuyerProfileDto)
  async updateMine(@CurrentUser() user: User, @Body() dto: UpdateBuyerDto) {
    const data = await this.buyers.updateMine(user, dto);
    return { data, message: 'Buyer profile updated' };
  }

  @Get(':id')
  @ApiOperation({
    summary: "Get a buyer's public profile",
    description: '{id} is the Buyer id, not the user id. Code only.',
  })
  @Auth()
  @ApiEnvelope(BuyerDto)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.buyers.findOne(id);
    return { data, message: 'Buyer retrieved' };
  }
}
