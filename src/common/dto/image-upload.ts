import { Type, applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';

export interface UploadField {
  name: string;
  required: boolean;
}

// Inlined in each body rather than $ref'd, and rebuilt per route so two
// routes never share one object: an uploaded file is a transport detail of
// the request, not a model the client should see.
function fileSchema(fields: UploadField[]) {
  return {
    type: 'object',
    required: fields.filter((field) => field.required).map(({ name }) => name),
    properties: Object.fromEntries(
      fields.map(({ name }) => [name, { type: 'string', format: 'binary' }]),
    ),
  };
}

/**
 * Documents a multipart route carrying the files in `fields`. Passing `dto`
 * merges them onto that DTO by `$ref`, so a route that sends fields alongside
 * its files still declares them only on the DTO.
 */
export function ApiFileUpload(
  dto: Type<unknown> | undefined,
  fields: UploadField[],
) {
  if (!dto) {
    return applyDecorators(
      ApiConsumes('multipart/form-data'),
      ApiBody({ schema: fileSchema(fields) }),
    );
  }
  return applyDecorators(
    ApiConsumes('multipart/form-data'),
    // The $ref below only resolves if the DTO is in components.schemas, and
    // nothing else puts it there: it is never a response type.
    ApiExtraModels(dto),
    ApiBody({
      schema: { allOf: [{ $ref: getSchemaPath(dto) }, fileSchema(fields)] },
    }),
  );
}

/** A multipart route carrying one required file in `file`. */
export function ApiImageUpload(dto?: Type<unknown>) {
  return ApiFileUpload(dto, [{ name: 'file', required: true }]);
}
