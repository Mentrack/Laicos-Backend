import { Type, applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';

// Inlined in each body rather than $ref'd, and rebuilt per route so two
// routes never share one object: an uploaded file is a transport detail of
// the request, not a model the client should see.
function fileSchema() {
  return {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  };
}

/**
 * Documents a multipart route carrying one required image in `file`. Passing
 * `dto` merges the image onto that DTO by `$ref`, so a route that sends
 * fields alongside the photo still declares them only on the DTO.
 */
export function ApiImageUpload(dto?: Type<unknown>) {
  if (!dto) {
    return applyDecorators(
      ApiConsumes('multipart/form-data'),
      ApiBody({ schema: fileSchema() }),
    );
  }
  return applyDecorators(
    ApiConsumes('multipart/form-data'),
    // The $ref below only resolves if the DTO is in components.schemas, and
    // nothing else puts it there: it is never a response type.
    ApiExtraModels(dto),
    ApiBody({
      schema: { allOf: [{ $ref: getSchemaPath(dto) }, fileSchema()] },
    }),
  );
}
