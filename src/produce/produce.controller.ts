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
import {
  CreateProduceDto,
  ProduceDto,
  ProduceQueryDto,
  UpdateProduceDto,
} from './dto';
import { ProduceService } from './produce.service';

@Controller('produce')
@ApiTags('Produce')
export class ProduceController {
  constructor(private readonly produce: ProduceService) {}

  @Post()
  @Auth(Role.FARMER)
  @ApiEnvelope(ProduceDto, { status: HttpStatus.CREATED })
  async create(@CurrentUser() user: User, @Body() dto: CreateProduceDto) {
    const data = await this.produce.create(user, dto);
    return { data, message: 'Produce created' };
  }

  @Get()
  @Auth()
  @ApiEnvelope(ProduceDto, { paginated: true })
  async findAll(@CurrentUser() user: User, @Query() query: ProduceQueryDto) {
    const { data, metaData } = await this.produce.findAll(user, query);
    return { data, message: 'Produce retrieved', metaData };
  }

  @Get(':id')
  @Auth()
  @ApiEnvelope(ProduceDto)
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.produce.findOne(user, id);
    return { data, message: 'Produce retrieved' };
  }

  @Patch(':id')
  @Auth(Role.FARMER)
  @ApiEnvelope(ProduceDto)
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProduceDto,
  ) {
    const data = await this.produce.update(user, id, dto);
    return { data, message: 'Produce updated' };
  }

  @Delete(':id')
  @Auth(Role.FARMER)
  @ApiEnvelope(ProduceDto)
  async remove(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.produce.remove(user, id);
    return { data, message: 'Produce deleted' };
  }
}
