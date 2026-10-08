import {
  Body,
  Controller,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope } from '../common/dto/envelope';
import { ApiFileUpload } from '../common/dto/image-upload';
import {
  DOCUMENT_MAX_BYTES,
  documentUploadPipe,
  type StorageUploadFile,
} from '../common/upload-pipes';
import { AgentRegistrationService } from './agent-registration.service';
import {
  AgentSignupDto,
  GoogleAgentSignupDto,
  RegisteredAgentDto,
} from './dto';

const ID_DOCUMENT = FileInterceptor('idDocument', {
  limits: { fileSize: DOCUMENT_MAX_BYTES },
});
const ID_DOCUMENT_FIELD = [{ name: 'idDocument', required: true }];

// Public, unlike AgentController's agents/me routes.
@Controller('agents')
@ApiTags('Agents')
export class AgentSignupController {
  constructor(private readonly registration: AgentRegistrationService) {}

  @Post('signup')
  @ApiOperation({
    summary: 'Sign up as an extension agent',
    description:
      'Public, multipart: my details, state and LGA, and idDocument (my ID; PDF or image, 10 MB). No password: I get access once an admin verifies me. Until then sign-in answers 403 VERIFICATION_PENDING. 409 when the email is registered.',
  })
  @UseInterceptors(ID_DOCUMENT)
  @ApiFileUpload(AgentSignupDto, ID_DOCUMENT_FIELD)
  @ApiEnvelope(RegisteredAgentDto, { status: HttpStatus.CREATED })
  async signUp(
    @Body() dto: AgentSignupDto,
    @UploadedFile(documentUploadPipe()) idDocument: StorageUploadFile,
  ) {
    const data = await this.registration.signUp(dto, idDocument);
    return { data, message: 'Profile submitted for verification' };
  }

  @Post('google-signup')
  @ApiOperation({
    summary: 'Sign up as an extension agent with Google',
    description:
      'As POST /agents/signup, with a Google ID token in place of name and email. Google sign-in works once an admin verifies me; no password is issued.',
  })
  @UseInterceptors(ID_DOCUMENT)
  @ApiFileUpload(GoogleAgentSignupDto, ID_DOCUMENT_FIELD)
  @ApiEnvelope(RegisteredAgentDto, { status: HttpStatus.CREATED })
  async signUpWithGoogle(
    @Body() dto: GoogleAgentSignupDto,
    @UploadedFile(documentUploadPipe()) idDocument: StorageUploadFile,
  ) {
    const data = await this.registration.signUpWithGoogle(dto, idDocument);
    return { data, message: 'Profile submitted for verification' };
  }
}
