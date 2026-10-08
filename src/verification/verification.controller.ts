import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VerificationCheckKey, type Agent } from '../../generated/client';
import {
  CurrentAgent,
  VerifiedAgent,
} from '../agent/decorators/verified-agent.decorator';
import { ApiEnvelope, MessageResponseDto } from '../common/dto/envelope';
import { ApiFileUpload, ApiImageUpload } from '../common/dto/image-upload';
import {
  DOCUMENT_MAX_BYTES,
  IMAGE_MAX_BYTES,
  ParseFileFieldsPipe,
  documentUploadPipe,
  imageUploadPipe,
  type StorageUploadFile,
} from '../common/upload-pipes';
import {
  AddEvidenceDto,
  SaveCheckDto,
  SaveLocationDto,
  UpdateVerificationDto,
  VerificationDto,
  VerificationQueryDto,
  VerificationReasonDto,
  VerificationSummaryDto,
} from './dto';
import type { FarmDocumentUploads } from './services/farm-documents.service';
import { VerificationService } from './services/verification.service';

// Every save returns the whole round, `outstanding` included, so the client
// re-renders the checklist from one response.
@Controller('verifications')
@ApiTags('Verifications')
@VerifiedAgent()
export class VerificationController {
  constructor(private readonly verifications: VerificationService) {}

  @Get()
  @ApiOperation({
    summary: 'List my verification tasks',
    description:
      'Filter by status, e.g. ASSIGNED for new tasks or IN_PROGRESS for drafts.',
  })
  @ApiEnvelope(VerificationSummaryDto, { paginated: true })
  async findAll(
    @CurrentAgent() agent: Agent,
    @Query() query: VerificationQueryDto,
  ) {
    const { data, metaData } = await this.verifications.findAll(agent, query);
    return { data, message: 'Verifications retrieved', metaData };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a verification task',
    description:
      'The farm, the farmer and their documents, everything recorded so far, and `outstanding`: what still blocks approval.',
  })
  @ApiEnvelope(VerificationDto)
  async findOne(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.verifications.findOne(agent, id);
    return { data, message: 'Verification retrieved' };
  }

  @Put(':id/location')
  @ApiOperation({
    summary: 'Save the location check',
    description:
      'matches: false records a discrepancy; add coordinates, a note and LOCATION_DISCREPANCY evidence before approving.',
  })
  @ApiEnvelope(VerificationDto)
  async saveLocation(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveLocationDto,
  ) {
    const data = await this.verifications.saveLocation(agent, id, dto);
    return { data, message: 'Location saved' };
  }

  @Put(':id/checks/:key')
  @ApiOperation({
    summary: 'Save one checklist item',
    description:
      'Identity checks take VERIFIED, ISSUE or UNABLE; the rest take VERIFIED, ISSUE or NOT_APPLICABLE. An ISSUE needs a note and CHECK evidence before approving.',
  })
  @ApiEnvelope(VerificationDto)
  async saveCheck(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key', new ParseEnumPipe(VerificationCheckKey))
    key: VerificationCheckKey,
    @Body() dto: SaveCheckDto,
  ) {
    const data = await this.verifications.saveCheck(agent, id, key, dto);
    return { data, message: 'Check saved' };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Save notes and measurements',
    description:
      'The identity note, measured size, estimated yield and the general inspection note.',
  })
  @ApiEnvelope(VerificationDto)
  async update(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVerificationDto,
  ) {
    const data = await this.verifications.update(agent, id, dto);
    return { data, message: 'Verification updated' };
  }

  @Post(':id/documents')
  @ApiOperation({
    summary: 'Upload the farmer’s or the farm’s documents',
    description:
      'For documents the farmer could not supply: they have no login until the farm is verified. Multipart: idDocument (the farmer’s ID), ownershipDocument and/or chiefConfirmation (PDF or image, 10 MB each); at least one. Each replaces what is stored. Approval needs the ID and the ownership document.',
  })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'idDocument', maxCount: 1 },
        { name: 'ownershipDocument', maxCount: 1 },
        { name: 'chiefConfirmation', maxCount: 1 },
      ],
      { limits: { fileSize: DOCUMENT_MAX_BYTES } },
    ),
  )
  @ApiFileUpload(undefined, [
    { name: 'idDocument', required: false },
    { name: 'ownershipDocument', required: false },
    { name: 'chiefConfirmation', required: false },
  ])
  @ApiEnvelope(VerificationDto)
  async uploadDocuments(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles(
      new ParseFileFieldsPipe(
        {
          idDocument: { required: false },
          ownershipDocument: { required: false },
          chiefConfirmation: { required: false },
        },
        documentUploadPipe,
      ),
    )
    uploads: FarmDocumentUploads,
  ) {
    const data = await this.verifications.uploadDocuments(agent, id, uploads);
    return { data, message: 'Documents uploaded' };
  }

  @Post(':id/evidence')
  @ApiOperation({
    summary: 'Upload an evidence photo',
    description:
      'Multipart image in `file` (5 MB). CHECK evidence names its checkKey; PHOTO evidence names its photoSlot and replaces that slot’s photo.',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES } }),
  )
  @ApiImageUpload(AddEvidenceDto)
  @ApiEnvelope(VerificationDto, { status: HttpStatus.CREATED })
  async addEvidence(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddEvidenceDto,
    @UploadedFile(imageUploadPipe()) file: StorageUploadFile,
  ) {
    const data = await this.verifications.addEvidence(agent, id, dto, file);
    return { data, message: 'Evidence added' };
  }

  @Delete(':id/evidence/:evidenceId')
  @ApiOperation({ summary: 'Remove an evidence photo' })
  @ApiEnvelope(VerificationDto)
  async removeEvidence(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
  ) {
    const data = await this.verifications.removeEvidence(agent, id, evidenceId);
    return { data, message: 'Evidence removed' };
  }

  @Post(':id/decline')
  @ApiOperation({
    summary: 'Decline this task',
    description:
      'A reason is required. The farm goes to another agent in its LGA, and whatever was recorded is discarded.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async decline(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationReasonDto,
  ) {
    await this.verifications.decline(agent, id, dto);
    return { data: null, message: 'Verification declined' };
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Approve the farm',
    description:
      'Verifies the farm and adds it to my cluster. 400 with every gap in error.details while the checklist is incomplete or the farmer’s ID or ownership document is missing. A farmer’s first verified farm gives them access and sends their invite.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(VerificationDto)
  async approve(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.verifications.approve(agent, id);
    return { data, message: 'Farm verified' };
  }

  @Post(':id/reject')
  @ApiOperation({
    summary: 'Reject the farm',
    description:
      'A reason is required; the checklist does not need to be complete. The farmer is sent the reason. An active farmer can edit the farm to resubmit it; one still awaiting their first verification cannot log in yet (open question).',
  })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(VerificationDto)
  async reject(
    @CurrentAgent() agent: Agent,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationReasonDto,
  ) {
    const data = await this.verifications.reject(agent, id, dto);
    return { data, message: 'Farm rejected' };
  }
}
