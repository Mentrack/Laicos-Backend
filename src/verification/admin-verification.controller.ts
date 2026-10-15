import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import {
  CreateInformationRequestDto,
  InformationRequestResultDto,
} from './dto/information-request.dto';
import { AdminVerificationService } from './services/admin-verification.service';

@Controller('admin/verifications')
@ApiTags('Verifications')
@Auth(Role.ADMIN)
export class AdminVerificationController {
  constructor(private readonly verifications: AdminVerificationService) {}

  @Post(':id/information-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the assigned agent for missing documents',
    description:
      '{id} is the verification round. Sets evidenceStatus to AWAITING_DOCS, stores the note, and emails the assigned agent. documents must be missing: FARMER_ID, LOCATION_EVIDENCE (location document), or HARVEST_ESTIMATE (signed declaration of harvest quantity). 409 when the round is approved or rejected, or when no agent is assigned. 404 when the round does not exist. The note is kept if the email fails.',
  })
  @ApiEnvelope(InformationRequestResultDto)
  async request(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInformationRequestDto,
  ) {
    const data = await this.verifications.request(id, dto);
    return { data, message: 'Information requested' };
  }
}
