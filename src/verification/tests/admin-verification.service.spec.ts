import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  EvidenceStatus,
  VerificationTaskStatus,
} from '../../../generated/client';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InformationRequestDocument } from '../dto/information-request.dto';
import { AdminVerificationService } from '../services/admin-verification.service';

const roundId = '1f0e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';

function round(overrides: Record<string, unknown> = {}) {
  return {
    id: roundId,
    status: VerificationTaskStatus.IN_PROGRESS,
    locationEvidenceKey: null,
    harvestEstimateKey: null,
    farm: {
      farmCode: 'LF-000451',
      owner: { idDocumentKey: 'farmers/farmer-1/id/a.pdf' },
    },
    agent: {
      user: { email: 'halima@laicos.test', firstName: 'Halima' },
    },
    ...overrides,
  };
}

describe('AdminVerificationService', () => {
  const farmVerification = { findUnique: jest.fn(), update: jest.fn() };
  const database = { farmVerification };
  const mail = { send: jest.fn() };
  const service = new AdminVerificationService(
    database as unknown as PrismaService,
    mail as unknown as MailService,
  );
  const request = {
    note: 'Please upload the location document and signed declaration.',
    documents: [
      InformationRequestDocument.LOCATION_EVIDENCE,
      InformationRequestDocument.HARVEST_ESTIMATE,
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    farmVerification.findUnique.mockResolvedValue(round());
    mail.send.mockResolvedValue(undefined);
  });

  it('stores the request and emails the assigned agent', async () => {
    const result = await service.request(roundId, request);

    expect(farmVerification.update).toHaveBeenCalledWith({
      where: { id: roundId },
      data: {
        evidenceStatus: EvidenceStatus.AWAITING_DOCS,
        informationRequestNote: request.note,
        informationRequestedAt: expect.any(Date) as Date,
      },
    });
    expect(mail.send).toHaveBeenCalledWith(
      'halima@laicos.test',
      expect.objectContaining({
        subject: expect.stringContaining('LF-000451') as string,
      }),
    );
    const sent = mail.send.mock.calls[0] as [string, { text: string }];
    expect(sent[1].text).toContain(request.note);
    expect(sent[1].text).toContain('Location document');
    expect(sent[1].text).toContain('Signed declaration');
    expect(result).toMatchObject({
      id: roundId,
      evidenceStatus: EvidenceStatus.AWAITING_DOCS,
      informationRequestNote: request.note,
      missing: [
        InformationRequestDocument.LOCATION_EVIDENCE,
        InformationRequestDocument.HARVEST_ESTIMATE,
      ],
    });
    expect(result.informationRequestedAt).toEqual(expect.any(Date));
  });

  it('keeps the request when the email fails', async () => {
    mail.send.mockRejectedValue(new Error('smtp down'));

    await expect(service.request(roundId, request)).resolves.toMatchObject({
      evidenceStatus: EvidenceStatus.AWAITING_DOCS,
    });
    expect(farmVerification.update).toHaveBeenCalled();
  });

  it('rejects a document that is already stored', async () => {
    await expect(
      service.request(roundId, {
        ...request,
        documents: [InformationRequestDocument.FARMER_ID],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(farmVerification.update).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('rejects a decided round', async () => {
    farmVerification.findUnique.mockResolvedValue(
      round({ status: VerificationTaskStatus.APPROVED }),
    );

    await expect(service.request(roundId, request)).rejects.toThrow(
      new ConflictException('Verification is already decided'),
    );
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('rejects a round with no agent', async () => {
    farmVerification.findUnique.mockResolvedValue(round({ agent: null }));

    await expect(service.request(roundId, request)).rejects.toThrow(
      new ConflictException('Assign an agent before requesting information'),
    );
    expect(farmVerification.update).not.toHaveBeenCalled();
  });

  it('404s a missing round', async () => {
    farmVerification.findUnique.mockResolvedValue(null);

    await expect(service.request(roundId, request)).rejects.toThrow(
      new NotFoundException('Verification not found'),
    );
  });
});
