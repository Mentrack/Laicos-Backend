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
  FarmProfileDto,
  FarmerDto,
  FarmerProfileDto,
  FarmerSignupDto,
  GoogleFarmerSignupDto,
  RegisteredFarmerDto,
  UpdateFarmDto,
} from './dto';
import { FarmProfileService } from './services/farm-profile.service';
import { FarmService, type FarmDocuments } from './services/farm.service';
import { FarmerRegistrationService } from './services/farmer-registration.service';
import { FarmerService } from './services/farmer.service';
import type { FarmDocumentUploads } from '../verification/services/farm-documents.service';

// Optional at the API: the agent can collect what the farmer lacks.
const SIGNUP_FILE_FIELDS = [
  { name: 'idDocument', required: false },
  { name: 'ownershipDocument', required: false },
  { name: 'chiefConfirmation', required: false },
];

const SIGNUP_FILES = FileFieldsInterceptor(
  SIGNUP_FILE_FIELDS.map(({ name }) => ({ name, maxCount: 1 })),
  { limits: { fileSize: DOCUMENT_MAX_BYTES } },
);

function signupFilesPipe() {
  return new ParseFileFieldsPipe(
    {
      idDocument: { required: false },
      ownershipDocument: { required: false },
      chiefConfirmation: { required: false },
    },
    documentUploadPipe,
  );
}

@Controller()
export class FarmController {
  constructor(
    private readonly farms: FarmService,
    private readonly farmers: FarmerService,
    private readonly registration: FarmerRegistrationService,
    private readonly farmProfiles: FarmProfileService,
  ) {}

  @Post('farms')
  @ApiOperation({
    summary: 'Create a farm',
    description:
      'Multipart: the farm fields, an optional ownershipDocument and an optional chiefConfirmation (PDF or image, 10 MB each). 400 until the farmer has uploaded their ID. The farm starts PENDING and is assigned to an agent in its LGA for verification.',
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
    { name: 'ownershipDocument', required: false },
    { name: 'chiefConfirmation', required: false },
  ])
  @ApiEnvelope(FarmDto, { status: HttpStatus.CREATED })
  async createFarm(
    @CurrentUser() user: User,
    @Body() dto: CreateFarmDto,
    @UploadedFiles(
      new ParseFileFieldsPipe(
        {
          ownershipDocument: { required: false },
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

  @Get('farms/:id/profile')
  @ApiOperation({
    summary: 'Get a farm’s public profile',
    description:
      'Any signed-in user. Verified farms only, except to their owner; never includes the address.',
  })
  @Auth()
  @ApiTags('Farms')
  @ApiEnvelope(FarmProfileDto)
  async findFarmProfile(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.farmProfiles.findOne(user, id);
    return { data, message: 'Farm profile retrieved' };
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

  @Post('farms/:id/documents')
  @ApiOperation({
    summary: 'Upload or replace one of my farm’s documents',
    description:
      'Multipart: ownershipDocument and/or chiefConfirmation (PDF or image, 10 MB each); at least one. Replaces what is stored. 409 once the farm is VERIFIED. An agent cannot approve a farm without its ownership document.',
  })
  @HttpCode(HttpStatus.OK)
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
  @ApiFileUpload(undefined, [
    { name: 'ownershipDocument', required: false },
    { name: 'chiefConfirmation', required: false },
  ])
  @ApiEnvelope(FarmDto)
  async replaceFarmDocuments(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles(
      new ParseFileFieldsPipe(
        {
          ownershipDocument: { required: false },
          chiefConfirmation: { required: false },
        },
        documentUploadPipe,
      ),
    )
    documents: FarmDocuments,
  ) {
    const data = await this.farms.replaceDocuments(user, id, documents);
    return { data, message: 'Farm documents updated' };
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

  @Post('farmers/signup')
  @ApiOperation({
    summary: 'Sign up as a farmer with my first farm',
    description:
      'Public, multipart: my details, the farm, and the documents idDocument (my ID), ownershipDocument and chiefConfirmation (PDF or image, 10 MB each). No password: I get access, and a temporary password by email, once an agent verifies the farm. Until then sign-in answers 403 VERIFICATION_PENDING. The agent can collect missing documents on site, but approval needs my ID and the ownership document. 409 when the email is registered.',
  })
  @ApiTags('Farmers')
  @UseInterceptors(SIGNUP_FILES)
  @ApiFileUpload(FarmerSignupDto, SIGNUP_FILE_FIELDS)
  @ApiEnvelope(RegisteredFarmerDto, { status: HttpStatus.CREATED })
  async signUp(
    @Body() dto: FarmerSignupDto,
    @UploadedFiles(signupFilesPipe()) documents: FarmDocumentUploads,
  ) {
    const data = await this.registration.signUp(dto, documents);
    return { data, message: 'Farm submitted for verification' };
  }

  @Post('farmers/google-signup')
  @ApiOperation({
    summary: 'Sign up as a farmer with Google',
    description:
      'As POST /farmers/signup, with a Google ID token in place of name and email. Google sign-in works once the farm is verified; no password is issued.',
  })
  @ApiTags('Farmers')
  @UseInterceptors(SIGNUP_FILES)
  @ApiFileUpload(GoogleFarmerSignupDto, SIGNUP_FILE_FIELDS)
  @ApiEnvelope(RegisteredFarmerDto, { status: HttpStatus.CREATED })
  async signUpWithGoogle(
    @Body() dto: GoogleFarmerSignupDto,
    @UploadedFiles(signupFilesPipe()) documents: FarmDocumentUploads,
  ) {
    const data = await this.registration.signUpWithGoogle(dto, documents);
    return { data, message: 'Farm submitted for verification' };
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
