import type { Application } from '../../../generated/client';
import type { StorageService } from '../../storage/storage.service';
import type { ApplicationDto } from '../dto/application.dto';

export async function formatApplication(
  storage: StorageService,
  application: Application,
): Promise<ApplicationDto> {
  const [idDocumentUrl, ownershipDocumentUrl, chiefConfirmationUrl] =
    await Promise.all([
      storage.presignedUrlOrNull(application.idDocumentKey),
      storage.presignedUrlOrNull(application.ownershipDocumentKey),
      storage.presignedUrlOrNull(application.chiefConfirmationKey),
    ]);
  return {
    id: application.id,
    status: application.status,
    phoneNumber: application.phoneNumber,
    agreedToTerms: application.agreedToTerms,
    idType: application.idType,
    idNumber: application.idNumber,
    idDocumentUrl,
    farmName: application.farmName,
    stateId: application.stateId,
    lgaId: application.lgaId,
    location: application.location,
    size: application.size,
    unit: application.unit,
    mainProduce: application.mainProduce,
    isExporting: application.isExporting,
    referralAgentId: application.referralAgentId,
    ownershipDocumentUrl,
    chiefConfirmationUrl,
  };
}
