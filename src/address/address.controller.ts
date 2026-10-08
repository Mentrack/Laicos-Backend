import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { AddressService } from './address.service';
import { AddressDto, CreateAddressDto, UpdateAddressDto } from './dto';

@Controller('addresses')
@ApiTags('Addresses')
@Auth(Role.BUYER)
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  @ApiOperation({
    summary: 'List my delivery addresses',
    description: 'Default first, then newest. At most 20.',
  })
  @ApiEnvelope(AddressDto, { list: true })
  async findAll(@CurrentUser() user: User) {
    const data = await this.addresses.findAll(user);
    return { data, message: 'Addresses retrieved' };
  }

  @Post()
  @ApiOperation({
    summary: 'Save a delivery address',
    description:
      'The first one becomes the default. 409 ADDRESS_LIMIT past 20.',
  })
  @ApiEnvelope(AddressDto, { status: HttpStatus.CREATED })
  async create(@CurrentUser() user: User, @Body() dto: CreateAddressDto) {
    const data = await this.addresses.create(user, dto);
    return { data, message: 'Address saved' };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a delivery address',
    description:
      'isDefault: true makes it the default. Placed checkouts keep the address they were placed with.',
  })
  @ApiEnvelope(AddressDto)
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    const data = await this.addresses.update(user, id, dto);
    return { data, message: 'Address updated' };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a delivery address',
    description: 'Deleting the default promotes the newest remaining one.',
  })
  @ApiEnvelope(AddressDto)
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.addresses.remove(user, id);
    return { data, message: 'Address deleted' };
  }
}
