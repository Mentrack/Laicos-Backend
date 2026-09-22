import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto } from './common/dto/error-response.dto';

/**
 * The single OpenAPI definition. Shared by main.ts (served) and
 * scripts/generate-openapi.ts (committed openapi.json) so the two can't drift.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('laicos API')
    .setVersion('1.0')
    // Firebase ID token; `@Auth()` marks each protected route with this scheme.
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  return SwaggerModule.createDocument(app, config, {
    // On by default in v11; it would add a "Farm" tag beside each route's own
    // @ApiTags, since FarmController serves both Farms and Farmers.
    autoTagControllers: false,
    // Emitted by HttpExceptionFilter, not by any route, so register it here.
    extraModels: [ErrorResponseDto],
  });
}
