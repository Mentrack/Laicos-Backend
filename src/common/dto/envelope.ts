import { HttpStatus, Type } from '@nestjs/common';
import { ApiProperty, ApiResponse } from '@nestjs/swagger';
import { PaginationMetaDto } from '../pagination';

interface EnvelopeShape {
  /** `data` is an array of `dto` and `metaData` is added. */
  paginated?: boolean;
  /** `data` is a complete, unpaginated array of `dto`. */
  list?: boolean;
}

/**
 * Builds the Swagger class for `{ data, message, metaData? }` so no route
 * declares its envelope by hand.
 */
export function enveloped(
  dto: Type<unknown>,
  name: string,
  { paginated = false, list = false }: EnvelopeShape = {},
): Type<unknown> {
  class Envelope {
    @ApiProperty({ example: 'OK' })
    message: string;
  }
  ApiProperty({ type: dto, isArray: paginated || list })(
    Envelope.prototype,
    'data',
  );
  if (paginated) {
    ApiProperty({ type: PaginationMetaDto })(Envelope.prototype, 'metaData');
  }
  // Swagger names the schema after the class, so each envelope needs its own.
  Object.defineProperty(Envelope, 'name', { value: name });
  return Envelope;
}

// Routes sharing a DTO must share one class: two classes with the same name
// would collide in components.schemas.
const envelopes = new Map<string, Type<unknown>>();

/**
 * Documents a route's enveloped response in one decorator. `FarmDto` becomes
 * `FarmResponseDto`, `FarmListResponseDto` when `paginated`, or
 * `FarmArrayResponseDto` when `list`.
 */
export function ApiEnvelope(
  dto: Type<unknown>,
  {
    paginated = false,
    list = false,
    status = HttpStatus.OK,
  }: EnvelopeShape & { status?: HttpStatus } = {},
) {
  const base = dto.name.replace(/Dto$/, '');
  const suffix = paginated ? 'List' : list ? 'Array' : '';
  const name = `${base}${suffix}ResponseDto`;
  let type = envelopes.get(name);
  if (!type) {
    type = enveloped(dto, name, { paginated, list });
    envelopes.set(name, type);
  }
  return ApiResponse({ status, type });
}

/** Envelope for routes that only report an outcome: `data` is always null. */
export class MessageResponseDto {
  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;

  @ApiProperty({ example: 'OK' })
  message: string;
}
