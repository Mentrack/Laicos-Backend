import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorResponseDto } from '../dto/error-response.dto';

const CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

const INTERNAL_MESSAGE = 'Something went wrong. Please try again later.';

/** The one place an error becomes a response body. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json(this.toBody(exception, status));
  }

  private toBody(exception: unknown, status: number): ErrorResponseDto {
    if (!(exception instanceof HttpException) || status >= 500) {
      // Internal faults are logged in full but never echoed to the client.
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
      return {
        message: INTERNAL_MESSAGE,
        error: { code: 'INTERNAL_ERROR', statusCode: status },
      };
    }

    const error = {
      code: CODES[status] ?? 'REQUEST_FAILED',
      statusCode: status,
    };
    const message = exceptionMessage(exception);
    if (Array.isArray(message)) {
      // ValidationPipe reports string[]; the client renders one string.
      return {
        message: capitalise(message[0] ?? exception.message),
        error: { ...error, details: message },
      };
    }
    return { message: capitalise(message), error };
  }
}

/** HttpException bodies are a string or `{ message: string | string[] }`. */
function exceptionMessage(exception: HttpException): string | string[] {
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  const message: unknown = 'message' in body ? body.message : undefined;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.filter((m): m is string => typeof m === 'string');
  }
  return exception.message;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
