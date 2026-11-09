import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { ApiFileUpload } from '../common/dto/image-upload';
import {
  IMAGE_MAX_BYTES,
  imageUploadPipe,
  type StorageUploadFile,
} from '../common/upload-pipes';
import { DisputeService, MAX_DISPUTE_PHOTOS } from './dispute.service';
import { DisputeDto, RaiseDisputeDto } from './dto';

@Controller('orders')
@ApiTags('Disputes')
export class DisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Post(':id/disputes')
  @ApiOperation({
    summary: 'Dispute a delivered order',
    description:
      "Multipart: `reason`, `quantityAffected` (1 to the order's quantity) and 1–5 `photos` (JPEG, PNG or WebP, 5 MB each). Allowed while the order is SHIPPED, or FULFILLED within the dispute window (PAYOUT_HOLD_HOURS after the buyer confirmed delivery), and before any payout on it. Holds the farmer's and agent's payouts until an admin resolves it. 409 DISPUTE_WINDOW_CLOSED, DISPUTE_EXISTS; 400 INVALID_QUANTITY.",
  })
  @Auth(Role.BUYER)
  @UseInterceptors(
    FilesInterceptor('photos', MAX_DISPUTE_PHOTOS, {
      limits: { fileSize: IMAGE_MAX_BYTES },
    }),
  )
  @ApiFileUpload(RaiseDisputeDto, [
    { name: 'photos', required: true, maxCount: MAX_DISPUTE_PHOTOS },
  ])
  @ApiEnvelope(DisputeDto, { status: HttpStatus.CREATED })
  async raise(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RaiseDisputeDto,
    @UploadedFiles(imageUploadPipe()) photos: StorageUploadFile[],
  ) {
    const data = await this.disputes.raise(user, id, dto, photos);
    return { data, message: 'Dispute raised' };
  }

  @Get(':id/dispute')
  @ApiOperation({
    summary: "Get an order's dispute",
    description:
      'For the buyer, the farm owner, the handover agent or an admin. Photo URLs are presigned. 404 DISPUTE_NOT_FOUND when there is none or the order is not yours.',
  })
  @Auth()
  @ApiEnvelope(DisputeDto)
  async findForOrder(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.disputes.findForOrder(user, id);
    return { data, message: 'Dispute retrieved' };
  }
}
