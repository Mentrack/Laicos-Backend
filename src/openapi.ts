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
    // Tag descriptions head each group in Swagger UI, in this order.
    .addTag(
      'Auth',
      'Registration, login (email/password or Google), token refresh, password reset and the signed-in user.',
    )
    .addTag(
      'Locations',
      'Nigerian states and LGAs for the location dropdowns. Public; no token needed.',
    )
    .addTag(
      'Farmers',
      'Farmer profiles. A farmer sets and uploads their ID here before they can create a farm.',
    )
    .addTag(
      'Farms',
      "A farmer's own farms. Creating a farm sends it for verification by an agent in its LGA; its produce stays hidden from buyers until an agent verifies it.",
    )
    .addTag(
      'Produce',
      'Produce listings. Farmers manage their own; everyone else sees published listings on verified farms.',
    )
    .addTag(
      'Orders',
      'Buyers place orders; farmers confirm, prepare (with a checklist) and mark them ready. Either side can cancel within its limits.',
    )
    .addTag(
      'Agents',
      "An extension agent's own profile, ID and cluster (the farms they manage). Usable before an admin verifies the agent.",
    )
    .addTag(
      'Verifications',
      'Farm verification tasks assigned to the calling agent: the on-site checklist, evidence photos, and the approve / reject / decline decision. Verified agents only.',
    )
    .build();
  return SwaggerModule.createDocument(app, config, {
    // On by default in v11; it would add a "Farm" tag beside each route's own
    // @ApiTags, since FarmController serves both Farms and Farmers.
    autoTagControllers: false,
    // Emitted by HttpExceptionFilter, not by any route, so register it here.
    extraModels: [ErrorResponseDto],
  });
}
