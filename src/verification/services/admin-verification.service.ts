import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EvidenceStatus,
  VerificationTaskStatus,
} from '../../../generated/client';
import { MailService } from '../../mail/mail.service';
import { informationRequestEmail } from '../../mail/templates';
import { PrismaService } from '../../prisma/prisma.service';
import {
  INFORMATION_REQUEST_LABEL,
  InformationRequestDocument,
  type CreateInformationRequestDto,
  type InformationRequestResultDto,
} from '../dto/information-request.dto';

const DECIDED: VerificationTaskStatus[] = [
  VerificationTaskStatus.APPROVED,
  VerificationTaskStatus.REJECTED,
];

const REQUESTABLE: InformationRequestDocument[] = [
  InformationRequestDocument.FARMER_ID,
  InformationRequestDocument.LOCATION_EVIDENCE,
  InformationRequestDocument.HARVEST_ESTIMATE,
];

interface RequestRound {
  locationEvidenceKey: string | null;
  harvestEstimateKey: string | null;
  farm: { owner: { idDocumentKey: string | null } };
}

@Injectable()
export class AdminVerificationService {
  private readonly logger = new Logger(AdminVerificationService.name);

  constructor(
    private readonly database: PrismaService,
    private readonly mail: MailService,
  ) {}

  async request(
    id: string,
    dto: CreateInformationRequestDto,
  ): Promise<InformationRequestResultDto> {
    const round = await this.database.farmVerification.findUnique({
      where: { id },
      select: {
        status: true,
        locationEvidenceKey: true,
        harvestEstimateKey: true,
        farm: {
          select: {
            farmCode: true,
            owner: { select: { idDocumentKey: true } },
          },
        },
        agent: {
          select: { user: { select: { email: true, firstName: true } } },
        },
      },
    });
    if (!round) {
      throw new NotFoundException('Verification not found');
    }
    if (DECIDED.includes(round.status)) {
      throw new ConflictException('Verification is already decided');
    }
    if (!round.agent) {
      throw new ConflictException(
        'Assign an agent before requesting information',
      );
    }

    const alreadyStored = dto.documents.filter((document) =>
      isStored(round, document),
    );
    if (alreadyStored.length) {
      throw new BadRequestException(
        alreadyStored.map(
          (document) =>
            `${INFORMATION_REQUEST_LABEL[document]} is already stored`,
        ),
      );
    }

    const informationRequestedAt = new Date();
    await this.database.farmVerification.update({
      where: { id },
      data: {
        evidenceStatus: EvidenceStatus.AWAITING_DOCS,
        informationRequestNote: dto.note,
        informationRequestedAt,
      },
    });

    try {
      await this.mail.send(
        round.agent.user.email,
        informationRequestEmail({
          firstName: round.agent.user.firstName,
          farmCode: round.farm.farmCode,
          documents: dto.documents.map(
            (document) => INFORMATION_REQUEST_LABEL[document],
          ),
          note: dto.note,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Information request for verification ${id} was saved but the agent was not emailed`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return {
      id,
      evidenceStatus: EvidenceStatus.AWAITING_DOCS,
      informationRequestNote: dto.note,
      informationRequestedAt,
      missing: REQUESTABLE.filter((document) => !isStored(round, document)),
    };
  }
}

function isStored(
  round: RequestRound,
  document: InformationRequestDocument,
): boolean {
  switch (document) {
    case InformationRequestDocument.FARMER_ID:
      return Boolean(round.farm.owner.idDocumentKey);
    case InformationRequestDocument.LOCATION_EVIDENCE:
      return Boolean(round.locationEvidenceKey);
    case InformationRequestDocument.HARVEST_ESTIMATE:
      return Boolean(round.harvestEstimateKey);
  }
}
