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
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { PaginationQueryDto } from '../common/pagination';
import { CreateFarmDto, FarmDto, FarmerDto, UpdateFarmDto } from './dto';
import { FarmService } from './services/farm.service';
import { FarmerService } from './services/farmer.service';

@Controller()
export class FarmController {
  constructor(
    private readonly farms: FarmService,
    private readonly farmers: FarmerService,
  ) {}

  @Post('farms')
  @Auth(Role.FARMER)
  @ApiTags('Farms')
  @ApiEnvelope(FarmDto, { status: HttpStatus.CREATED })
  async createFarm(@CurrentUser() user: User, @Body() dto: CreateFarmDto) {
    const data = await this.farms.create(user, dto);
    return { data, message: 'Farm created' };
  }

  @Get('farms')
  @Auth(Role.FARMER)
  @ApiTags('Farms')
  @ApiEnvelope(FarmDto, { paginated: true })
  async findFarms(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ) {
    const { data, metaData } = await this.farms.findAll(user, query);
    return { data, message: 'Farms retrieved', metaData };
  }

  @Get('farms/:id')
  @Auth(Role.FARMER)
  @ApiTags('Farms')
  @ApiEnvelope(FarmDto)
  async findFarm(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.farms.findOne(user, id);
    return { data, message: 'Farm retrieved' };
  }

  @Patch('farms/:id')
  @Auth(Role.FARMER)
  @ApiTags('Farms')
  @ApiEnvelope(FarmDto)
  async updateFarm(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFarmDto,
  ) {
    const data = await this.farms.update(user, id, dto);
    return { data, message: 'Farm updated' };
  }

  @Delete('farms/:id')
  @Auth(Role.FARMER)
  @ApiTags('Farms')
  @ApiEnvelope(FarmDto)
  async removeFarm(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.farms.remove(user, id);
    return { data, message: 'Farm deleted' };
  }

  @Get('farmers')
  // @Auth(Role.ADMIN)
  @ApiTags('Farmers')
  @ApiEnvelope(FarmerDto, { paginated: true })
  async findFarmers(@Query() query: PaginationQueryDto) {
    const { data, metaData } = await this.farmers.findAll(query);
    return { data, message: 'Farmers retrieved', metaData };
  }

  @Get('farmers/me')
  @Auth(Role.FARMER)
  @ApiTags('Farmers')
  @ApiEnvelope(FarmerDto)
  async findMyFarmer(@CurrentUser() user: User) {
    const data = await this.farmers.findMine(user);
    return { data, message: 'Farmer profile retrieved' };
  }

  @Get('farmers/:id')
  @Auth()
  @ApiTags('Farmers')
  @ApiEnvelope(FarmerDto)
  async findFarmer(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.farmers.findOne(id);
    return { data, message: 'Farmer retrieved' };
  }
}
