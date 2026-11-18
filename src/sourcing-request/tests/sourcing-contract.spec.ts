import type { Prisma } from '../../../generated/client';
import { isFullySigned, voidLiveContract } from '../utils/sourcing-contract';

describe('sourcing contract', () => {
  const clientWith = (updateMany: jest.Mock) =>
    ({
      sourcingContract: { updateMany },
    }) as unknown as Prisma.TransactionClient;

  describe('voidLiveContract', () => {
    it('voids only the live contract of the request', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      await voidLiveContract(clientWith(updateMany), 'request-1');
      expect(updateMany).toHaveBeenCalledWith({
        where: { sourcingRequestId: 'request-1', voidedAt: null },
        data: { voidedAt: expect.any(Date) as Date },
      });
    });

    it('is a no-op when there is no live contract', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      await expect(
        voidLiveContract(clientWith(updateMany), 'request-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('isFullySigned', () => {
    const at = new Date('2026-11-18T00:00:00.000Z');

    it.each([
      [null, null, false],
      [at, null, false],
      [null, at, false],
      [at, at, true],
    ])('buyer %p, agent %p -> %p', (buyerSignedAt, agentSignedAt, expected) => {
      expect(isFullySigned({ buyerSignedAt, agentSignedAt })).toBe(expected);
    });
  });
});
