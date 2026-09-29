import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { UpdateIdentityDto } from '../common/dto/identity.dto';
import { ApiFileUpload, ApiImageUpload } from '../common/dto/image-upload';
import { PaginationQueryDto } from '../common/pagination';
import {
  DOCUMENT_MAX_BYTES,
  ParseFileFieldsPipe,
  documentUploadPipe,
  type StorageUploadFile,
} from '../common/upload-pipes';
import {
  CreateFarmDto,
  FarmDto,
  FarmerDto,
  FarmerProfileDto,
  UpdateFarmDto,
} from './dto';
import { FarmService, type FarmDocuments } from './services/farm.service';
import { FarmerService } from './services/farmer.service';

@Controller()
export class FarmController {
  constructor(
    private readonly farms: FarmService,
    private readonly farmers: FarmerService,
  ) {}

  @Post('farms')
  @ApiOperation({
    summary: 'Create a farm',
    description:
      'Multipart: the farm fields, a required ownershipDocument and an optional chiefConfirmation (PDF or image, 10 MB each). 400 until the farmer has uploaded their ID. The farm starts PENDING and is assigned to an agent in its LGA for verification.',
  })
  @Auth(Role.FARMER)
  @ApiTags('Farms')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'ownershipDocument', maxCount: 1 },
        { name: 'chiefConfirmation', maxCount: 1 },
      ],
      { limits: { fileSize: DOCUMENT_MAX_BYTES } },
    ),
  )
  @ApiFileUpload(CreateFarmDto, [
    { name: 'ownershipDocument', required: true },
    { name: 'chiefConfirmation', required: false },
  ])
  @ApiEnvelope(FarmDto, { status: HttpStatus.CREATED })
  async createFarm(
    @CurrentUser() user: User,
    @Body() dto: CreateFarmDto,
    @UploadedFiles(
      new ParseFileFieldsPipe(
        {
          ownershipDocument: { required: true },
          chiefConfirmation: { required: false },
        },
        documentUploadPipe,
      ),
    )
    documents: FarmDocuments,
  ) {
    const data = await this.farms.create(user, dto, documents);
    return { data, message: 'Farm created' };
  }

  @Get('farms')
  @ApiOperation({ summary: 'List my farms' })
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
  @ApiOperation({ summary: 'Get one of my farms' })
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
  @ApiOperation({
    summary: 'Update one of my farms',
    description:
      'Editing a REJECTED farm resubmits it for verification. Changing the state, LGA or address of a VERIFIED farm sends it back to PENDING and out of its cluster; other edits keep it verified.',
  })
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
  @ApiOperation({
    summary: 'Delete one of my farms',
    description: '409 once the farm has orders.',
  })
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
  @ApiOperation({ summary: 'List farmers' })
  // @Auth(Role.ADMIN)
  @ApiTags('Farmers')
  @ApiEnvelope(FarmerDto, { paginated: true })
  async findFarmers(@Query() query: PaginationQueryDto) {
    const { data, metaData } = await this.farmers.findAll(query);
    return { data, message: 'Farmers retrieved', metaData };
  }

  // Declared before farmers/:id so "me" isn't parsed as an id.
  @Get('farmers/me')
  @ApiOperation({
    summary: 'Get my farmer profile',
    description:
      'Includes my ID details and a short-lived link to my ID document.',
  })
  @Auth(Role.FARMER)
  @ApiTags('Farmers')
  @ApiEnvelope(FarmerProfileDto)
  async findMyFarmer(@CurrentUser() user: User) {
    const data = await this.farmers.findMine(user);
    return { data, message: 'Farmer profile retrieved' };
  }

  @Patch('farmers/me')
  @ApiOperation({ summary: 'Set my ID type and number' })
  @Auth(Role.FARMER)
  @ApiTags('Farmers')
  @ApiEnvelope(FarmerProfileDto)
  async updateMyFarmer(
    @CurrentUser() user: User,
    @Body() dto: UpdateIdentityDto,
  ) {
    const data = await this.farmers.updateMine(user, dto);
    return { data, message: 'Farmer profile updated' };
  }

  @Post('farmers/me/id-document')
  @ApiOperation({
    summary: 'Upload my ID document',
    description:
      'PDF or image, 10 MB max. Replaces any earlier upload. Required before creating a farm.',
  })
  @HttpCode(HttpStatus.OK)
  @Auth(Role.FARMER)
  @ApiTags('Farmers')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES } }),
  )
  @ApiImageUpload()
  @ApiEnvelope(FarmerProfileDto)
  async uploadMyIdDocument(
    @CurrentUser() user: User,
    @UploadedFile(documentUploadPipe()) file: StorageUploadFile,
  ) {
    const data = await this.farmers.uploadIdDocument(user, file);
    return { data, message: 'ID document uploaded' };
  }

  @Get('farmers/:id')
  @ApiOperation({ summary: 'Get a farmer’s public profile' })
  @Auth()
  @ApiTags('Farmers')
  @ApiEnvelope(FarmerDto)
  async findFarmer(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.farmers.findOne(id);
    return { data, message: 'Farmer retrieved' };
  }
}
