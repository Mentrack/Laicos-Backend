import { HttpStatus, Type } from '@nestjs/common';
import { ApiProperty, ApiResponse } from '@nestjs/swagger';
import { PaginationMetaDto } from '../pagination';

/**
 * Builds the Swagger class for `{ data, message, metaData? }` so no route
 * declares its envelope by hand. `paginated` makes `data` an array of `dto`
 * and adds `metaData`.
 */
export function enveloped(
  dto: Type<unknown>,
  name: string,
  { paginated = false }: { paginated?: boolean } = {},
): Type<unknown> {
  class Envelope {
    @ApiProperty({ example: 'OK' })
    message: string;
  }
  ApiProperty({ type: dto, isArray: paginated })(Envelope.prototype, 'data');
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
 * `FarmResponseDto`, or `FarmListResponseDto` when `paginated`.
 */
export function ApiEnvelope(
  dto: Type<unknown>,
  {
    paginated = false,
    status = HttpStatus.OK,
  }: { paginated?: boolean; status?: HttpStatus } = {},
) {
  const base = dto.name.replace(/Dto$/, '');
  const name = `${base}${paginated ? 'List' : ''}ResponseDto`;
  let type = envelopes.get(name);
  if (!type) {
    type = enveloped(dto, name, { paginated });
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
