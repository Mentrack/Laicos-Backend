import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '../../../generated/client';
import { ActivationGuard } from '../guards/activation.guard';

function contextFor(
  role: Role,
  activatedAt: Date | null,
  isVerified = true,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { role, activatedAt, isVerified } }),
    }),
  } as unknown as ExecutionContext;
}

function refusalOf(role: Role): ForbiddenException {
  let error: unknown;
  try {
    new ActivationGuard().canActivate(contextFor(role, null));
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ForbiddenException);
  return error as ForbiddenException;
}

describe('ActivationGuard', () => {
  const guard = new ActivationGuard();

  it('lets an activated farmer through', () => {
    expect(guard.canActivate(contextFor(Role.FARMER, new Date()))).toBe(true);
  });

  it('lets an activated agent through', () => {
    expect(
      guard.canActivate(contextFor(Role.EXTENSION_AGENT, new Date())),
    ).toBe(true);
  });

  it('ignores activation for other roles', () => {
    expect(guard.canActivate(contextFor(Role.BUYER, null))).toBe(true);
  });

  it('stops a farmer awaiting verification with a distinct code', () => {
    expect(refusalOf(Role.FARMER).getResponse()).toMatchObject({
      code: 'VERIFICATION_PENDING',
      message: 'Your farm is awaiting verification',
    });
  });

  it('stops an agent awaiting verification with the same code', () => {
    expect(refusalOf(Role.EXTENSION_AGENT).getResponse()).toMatchObject({
      code: 'VERIFICATION_PENDING',
      message: 'Your profile is awaiting verification',
    });
  });

  it.each([Role.BUYER, Role.RIDER])(
    'stops an unverified %s whose token came straight from Firebase',
    (role) => {
      let error: unknown;
      try {
        guard.canActivate(contextFor(role, null, false));
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
      });
    },
  );
});
