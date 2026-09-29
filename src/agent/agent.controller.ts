import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '../../generated/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiEnvelope } from '../common/dto/envelope';
import { ApiImageUpload } from '../common/dto/image-upload';
import { PaginationQueryDto } from '../common/pagination';
import {
  DOCUMENT_MAX_BYTES,
  documentUploadPipe,
  type StorageUploadFile,
} from '../common/upload-pipes';
import { FarmDto } from '../farm/dto';
import { AgentService } from './agent.service';
import { AgentProfileDto, UpdateAgentDto } from './dto';

// Profile routes work before an admin verifies the agent: that is when the
// agent fills them in.
@Controller('agents/me')
@ApiTags('Agents')
@Auth(Role.EXTENSION_AGENT)
export class AgentController {
  constructor(private readonly agents: AgentService) {}

  @Get()
  @ApiOperation({
    summary: 'Get my agent profile',
    description:
      'Includes verification status and my cluster’s name and farm count.',
  })
  @ApiEnvelope(AgentProfileDto)
  async findMine(@CurrentUser() user: User) {
    const data = await this.agents.findMine(user);
    return { data, message: 'Agent profile retrieved' };
  }

  @Patch()
  @ApiOperation({
    summary: 'Update my location and ID details',
    description:
      'Send stateId and lgaId together. The LGA cannot change once an admin has verified me.',
  })
  @ApiEnvelope(AgentProfileDto)
  async updateMine(@CurrentUser() user: User, @Body() dto: UpdateAgentDto) {
    const data = await this.agents.updateMine(user, dto);
    return { data, message: 'Agent profile updated' };
  }

  @Post('id-document')
  @ApiOperation({
    summary: 'Upload my ID document',
    description: 'PDF or image, 10 MB max. Replaces any earlier upload.',
  })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES } }),
  )
  @ApiImageUpload()
  @ApiEnvelope(AgentProfileDto)
  async uploadIdDocument(
    @CurrentUser() user: User,
    @UploadedFile(documentUploadPipe()) file: StorageUploadFile,
  ) {
    const data = await this.agents.uploadIdDocument(user, file);
    return { data, message: 'ID document uploaded' };
  }

  @Get('cluster/farms')
  @ApiOperation({ summary: 'List the farms in my cluster' })
  @ApiEnvelope(FarmDto, { paginated: true })
  async findClusterFarms(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ) {
    const { data, metaData } = await this.agents.findClusterFarms(user, query);
    return { data, message: 'Cluster farms retrieved', metaData };
  }
}
