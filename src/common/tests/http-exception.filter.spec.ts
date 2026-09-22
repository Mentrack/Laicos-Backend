import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { HttpExceptionFilter } from '../filters/http-exception.filter';

function run(exception: unknown) {
  const json = jest.fn<void, [ErrorResponseDto]>();
  const status = jest.fn<{ json: typeof json }, [number]>(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('HttpExceptionFilter', () => {
  beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());

  it('moves validation arrays to details and capitalises the first', () => {
    const { status, body } = run(
      new BadRequestException([
        'name should not be empty',
        'size must be positive',
      ]),
    );
    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body).toEqual({
      message: 'Name should not be empty',
      error: {
        code: 'VALIDATION_FAILED',
        statusCode: 400,
        details: ['name should not be empty', 'size must be positive'],
      },
    });
  });

  it('passes a single message through without details', () => {
    const { body } = run(new NotFoundException('Farm not found'));
    expect(body).toEqual({
      message: 'Farm not found',
      error: { code: 'NOT_FOUND', statusCode: 404 },
    });
  });

  it('hides the cause of unknown errors behind a generic 500', () => {
    const { status, body } = run(new Error('connection refused'));
    expect(status).toBe(500);
    expect(body.message).not.toContain('connection refused');
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', statusCode: 500 });
  });
});
