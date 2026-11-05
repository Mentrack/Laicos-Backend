import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '../../generated/client';
import { AllowPendingApplication } from '../auth/decorators/allow-pending-application.decorator';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { ApiFileUpload } from '../common/dto/image-upload';
import {
  DOCUMENT_MAX_BYTES,
  ParseFileFieldsPipe,
  documentUploadPipe,
} from '../common/upload-pipes';
import {
  ApplicationService,
  type ApplicationFiles,
} from './application.service';
import { ApplicationDto } from './dto/application.dto';
import { SaveApplicationDto } from './dto/save-application.dto';

const FILE_FIELDS = [
  { name: 'idDocument', required: false },
  { name: 'ownershipDocument', required: false },
  { name: 'chiefConfirmation', required: false },
];

const FILES = FileFieldsInterceptor(
  FILE_FIELDS.map(({ name }) => ({ name, maxCount: 1 })),
  { limits: { fileSize: DOCUMENT_MAX_BYTES } },
);

function filesPipe() {
  return new ParseFileFieldsPipe(
    {
      idDocument: { required: false },
      ownershipDocument: { required: false },
      chiefConfirmation: { required: false },
    },
    documentUploadPipe,
  );
}

@ApiTags('Application')
@Controller('applications')
@Auth()
@AllowPendingApplication()
export class ApplicationController {
  constructor(private readonly applications: ApplicationService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Read my application',
    description:
      'The form filed after signup. Available before verification. 404 when this account has no application.',
  })
  @ApiEnvelope(ApplicationDto)
  async findMine(@CurrentUser() user: User) {
    const data = await this.applications.findMine(user);
    return { data, message: 'Application retrieved' };
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Save my application',
    description:
      'Multipart. Send only the fields that changed. Files are idDocument, ownershipDocument and chiefConfirmation (PDF or image, 10 MB). 409 once the application is completed.',
  })
  @UseInterceptors(FILES)
  @ApiFileUpload(SaveApplicationDto, FILE_FIELDS)
  @ApiEnvelope(ApplicationDto)
  async save(
    @CurrentUser() user: User,
    @Body() dto: SaveApplicationDto,
    @UploadedFiles(filesPipe()) files: ApplicationFiles,
  ) {
    const data = await this.applications.save(user, dto, files);
    return { data, message: 'Application saved' };
  }

  @Post('me/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit my application for review',
    description:
      'Same body as the save. 400 with every gap in error.details while required data is missing, and the application stays a draft. Completing it creates the farmer and farm, or the agent and cluster, and emails that the form is pending review.',
  })
  @UseInterceptors(FILES)
  @ApiFileUpload(SaveApplicationDto, FILE_FIELDS)
  @ApiEnvelope(ApplicationDto)
  async complete(
    @CurrentUser() user: User,
    @Body() dto: SaveApplicationDto,
    @UploadedFiles(filesPipe()) files: ApplicationFiles,
  ) {
    const data = await this.applications.complete(user, dto, files);
    return { data, message: 'Application submitted for review' };
  }
}
