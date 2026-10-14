import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Agent } from '../../generated/client';
import {
  CurrentAgent,
  VerifiedAgent,
} from '../agent/decorators/verified-agent.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { ApiImageUpload } from '../common/dto/image-upload';
import {
  IMAGE_MAX_BYTES,
  imageUploadPipe,
  type StorageUploadFile,
} from '../common/upload-pipes';
import {
  CompleteHandoverDto,
  HandoverDto,
  HandoverQueryDto,
  VerifyHandoverDto,
} from './dto';
import { HandoverService } from './handover.service';

// Keyed by order id: a handover is one-to-one with its order.
@Controller('handovers')
@ApiTags('Handovers')
@VerifiedAgent()
export class HandoverController {
  constructor(private readonly handovers: HandoverService) {}

  @Get()
  @ApiOperation({
    summary: 'List my order handovers',
    description:
      'READY orders from my cluster. Filter by status, e.g. PENDING for orders still to verify.',
  })
  @ApiEnvelope(HandoverDto, { paginated: true })
  async findAll(
    @CurrentAgent() agent: Agent,
    @Query() query: HandoverQueryDto,
  ) {
    const { data, metaData } = await this.handovers.findAll(agent, query);
    return { data, message: 'Handovers retrieved', metaData };
  }

  @Get(':orderId')
  @ApiOperation({
    summary: 'Get an order handover',
    description:
      "Keyed by order id. Another agent's handover is 404, the same as a missing one.",
  })
  @ApiEnvelope(HandoverDto)
  async findOne(
    @CurrentAgent() agent: Agent,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const data = await this.handovers.findOne(agent, orderId);
    return { data, message: 'Handover retrieved' };
  }

  @Post(':orderId/verify')
  @ApiOperation({
    summary: 'Verify the order’s goods',
    description: 'PENDING -> VERIFIED, after checking the goods at the farm.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(HandoverDto)
  async verify(
    @CurrentAgent() agent: Agent,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: VerifyHandoverDto,
  ) {
    const data = await this.handovers.verify(agent, orderId, dto);
    return { data, message: 'Order verified' };
  }

  @Post(':orderId/complete')
  @ApiOperation({
    summary: 'Hand the order over to logistics',
    description:
      'VERIFIED -> HANDED_OVER, recording who took the goods. The order becomes SHIPPED.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiEnvelope(HandoverDto)
  async complete(
    @CurrentAgent() agent: Agent,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CompleteHandoverDto,
  ) {
    const data = await this.handovers.complete(agent, orderId, dto);
    return { data, message: 'Order handed over' };
  }

  @Post(':orderId/proof')
  @ApiOperation({
    summary: 'Upload a handover proof photo',
    description:
      'Multipart image in `file` (JPEG, PNG or WebP, 5 MB). Allowed while the handover is PENDING or VERIFIED. Call again to add another photo.',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES } }),
  )
  @ApiImageUpload()
  @ApiEnvelope(HandoverDto, { status: HttpStatus.CREATED })
  async addProof(
    @CurrentAgent() agent: Agent,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @UploadedFile(imageUploadPipe()) file: StorageUploadFile,
  ) {
    const data = await this.handovers.addProof(agent, orderId, file);
    return { data, message: 'Proof added' };
  }

  @Delete(':orderId/proof/:proofId')
  @ApiOperation({
    summary: 'Remove a handover proof photo',
    description:
      'Deletes the photo and its stored file. 409 once the order has been handed over.',
  })
  @ApiEnvelope(HandoverDto)
  async removeProof(
    @CurrentAgent() agent: Agent,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('proofId', ParseUUIDPipe) proofId: string,
  ) {
    const data = await this.handovers.removeProof(agent, orderId, proofId);
    return { data, message: 'Proof removed' };
  }
}
