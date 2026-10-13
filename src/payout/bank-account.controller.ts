import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type Agent, type User } from '../../generated/client';
import {
  CurrentAgent,
  VerifiedAgent,
} from '../agent/decorators/verified-agent.decorator';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { BankAccountService } from './bank-account.service';
import { BankAccountDto, BankDto, SetBankAccountDto } from './dto';

const SET_DESCRIPTION =
  "Resolves the account with Paystack (422 BANK_ACCOUNT_UNRESOLVED if the bank can't find it) and registers it for payouts. Check accountName in the response is the farmer. Any change holds the farmer's payouts for 24h. 400 UNKNOWN_BANK for a code not in GET /banks; 409 PAYMENT_PROVIDER_UNAVAILABLE when Paystack is down.";

@Controller()
@ApiTags('Bank accounts')
export class BankAccountController {
  constructor(private readonly accounts: BankAccountService) {}

  @Get('banks')
  @ApiOperation({
    summary: 'List Nigerian banks for payouts',
    description:
      "Farmers and agents, for the payout account form. From Paystack, cached for a day; not paginated. 409 PAYMENT_PROVIDER_UNAVAILABLE when Paystack can't be reached.",
  })
  @Auth(Role.FARMER, Role.EXTENSION_AGENT)
  @ApiEnvelope(BankDto, { list: true })
  async banks() {
    const data = await this.accounts.listBanks();
    return { data, message: 'Banks retrieved' };
  }

  @Get('farmers/me/bank-account')
  @ApiOperation({
    summary: 'Get my payout bank account',
    description: '404 BANK_ACCOUNT_NOT_FOUND until one is set.',
  })
  @Auth(Role.FARMER)
  @ApiEnvelope(BankAccountDto)
  async findMine(@CurrentUser() user: User) {
    const data = await this.accounts.findMine(user);
    return { data, message: 'Bank account retrieved' };
  }

  @Put('farmers/me/bank-account')
  @ApiOperation({
    summary: 'Set my payout bank account',
    description: SET_DESCRIPTION,
  })
  @Auth(Role.FARMER)
  @ApiEnvelope(BankAccountDto)
  async setMine(@CurrentUser() user: User, @Body() dto: SetBankAccountDto) {
    const data = await this.accounts.setMine(user, dto);
    return { data, message: 'Bank account saved' };
  }

  @Put('agents/me/farmers/:farmerId/bank-account')
  @ApiOperation({
    summary: "Set a cluster farmer's payout bank account",
    description: `Verified agents only, for farmers with a farm in my cluster (404 FARMER_NOT_FOUND otherwise). ${SET_DESCRIPTION}`,
  })
  @VerifiedAgent()
  @ApiEnvelope(BankAccountDto)
  async setForFarmer(
    @CurrentAgent() agent: Agent,
    @CurrentUser() user: User,
    @Param('farmerId', ParseUUIDPipe) farmerId: string,
    @Body() dto: SetBankAccountDto,
  ) {
    const data = await this.accounts.setForFarmer(agent, user, farmerId, dto);
    return { data, message: 'Bank account saved' };
  }
}
