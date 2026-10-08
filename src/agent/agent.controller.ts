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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type Agent, type User } from '../../generated/client';
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
import { FarmDto, RegisteredFarmerDto } from '../farm/dto';
import { AgentService } from './agent.service';
import { CurrentAgent } from './decorators/verified-agent.decorator';
import {
  AgentProfileDto,
  AgentTaskDto,
  AgentTaskQueryDto,
  ClusterFarmerDto,
  OnboardFarmerDto,
  UpdateAgentDto,
} from './dto';
import { FarmerOnboardingService } from './farmer-onboarding.service';
import { VerifiedAgentGuard } from './guards/verified-agent.guard';

// Profile routes work before an admin verifies the agent: that is when the
// agent fills them in.
@Controller('agents/me')
@ApiTags('Agents')
@Auth(Role.EXTENSION_AGENT)
export class AgentController {
  constructor(
    private readonly agents: AgentService,
    private readonly onboarding: FarmerOnboardingService,
  ) {}

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

  @Get('cluster/farmers')
  @ApiOperation({
    summary: 'List the farmers in my cluster',
    description:
      'Farmers with at least one farm in my cluster (so verified), newest first. farmCount counts only those farms.',
  })
  @ApiEnvelope(ClusterFarmerDto, { paginated: true })
  async findClusterFarmers(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ) {
    const { data, metaData } = await this.agents.findClusterFarmers(
      user,
      query,
    );
    return { data, message: 'Cluster farmers retrieved', metaData };
  }

  // Not @VerifiedAgent(): the class's @Auth already ran, and class guards run
  // before method guards, so req.user is set by the time this one runs.
  @Post('farmers')
  @UseGuards(VerifiedAgentGuard)
  @ApiOperation({
    summary: 'Onboard a farmer and their first farm',
    description:
      'Verified agents only. Creates the farmer without a password: like self-signup, they get access, and a temporary password by invite, when the farm is verified. The farm takes my state and LGA, names me as referral, and its verification round is assigned to me. Upload the farmer’s ID and the ownership document through POST /verifications/{id}/documents; approval needs both. 409 when the email is registered.',
  })
  @ApiEnvelope(RegisteredFarmerDto, { status: HttpStatus.CREATED })
  async onboardFarmer(
    @CurrentAgent() agent: Agent,
    @Body() dto: OnboardFarmerDto,
  ) {
    const data = await this.onboarding.onboard(agent, dto);
    return { data, message: 'Farmer onboarded' };
  }

  @Get('tasks')
  @ApiOperation({
    summary: 'List my open tasks',
    description:
      'Farm verifications (ASSIGNED or IN_PROGRESS) and order handovers (PENDING or VERIFIED), newest first. Filter by type.',
  })
  @ApiEnvelope(AgentTaskDto, { paginated: true })
  async findTasks(
    @CurrentUser() user: User,
    @Query() query: AgentTaskQueryDto,
  ) {
    const { data, metaData } = await this.agents.findTasks(user, query);
    return { data, message: 'Tasks retrieved', metaData };
  }
}
