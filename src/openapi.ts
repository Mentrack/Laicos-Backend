import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto } from './common/dto/error-response.dto';
import { ConversationReadEventDto } from './conversation/dto';

/**
 * The single OpenAPI definition. Shared by main.ts (served) and
 * scripts/generate-openapi.ts (committed openapi.json) so the two can't drift.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  baseUrl: string,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('laicos API')
    .setVersion('1.0')
    .setExternalDoc('Swagger UI', `${baseUrl}/v1/docs`)
    // Firebase ID token; `@Auth()` marks each protected route with this scheme.
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    // Tag descriptions head each group in Swagger UI, in this order.
    .addTag(
      'Auth',
      'Registration, login (email/password or Google), token refresh, password reset, the signed-in user, and their name, phone and avatar.',
    )
    .addTag(
      'Admins',
      'Admin profiles. The first admin is seeded; an existing admin invites the next ones. Name and email stay on the user.',
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
      'Cart',
      "A buyer's cart and checkout. Adding to the cart reserves nothing; checkout reserves the stock and places unpaid orders under one checkout. A guest keeps the cart on the device, prices it with POST /cart/quote and merges it after sign-in with POST /cart/items/bulk.",
    )
    .addTag(
      'Addresses',
      "A buyer's saved delivery addresses, up to 20. The first becomes the default; a placed checkout keeps the address it was placed with.",
    )
    .addTag(
      'Payments',
      'Paying for a checkout through Paystack, in naira or dollars. The checkout becomes PAID when Paystack confirms the charge. Admins can re-check a payment and issue refunds.',
    )
    .addTag(
      'FX',
      'The naira-per-dollar rate, with the margin already applied, for showing and charging prices in USD. Public; no token needed.',
    )
    .addTag(
      'Orders',
      'Buyers place orders; farmers confirm, prepare (with a checklist) and mark them ready. Either side can cancel within its limits.',
    )
    .addTag(
      'Sourcing Requests',
      'A buyer asks LAICOS to source produce that is not listed. Buyers create requests and read their own; each starts UNDER_REVIEW.',
    )
    .addTag(
      'Agents',
      "An extension agent's own profile, ID and cluster (the farms they manage). Usable before an admin verifies the agent.",
    )
    .addTag(
      'Verifications',
      'Farm verification tasks assigned to the calling agent: the on-site checklist, evidence photos, and the approve / reject / decline decision. Verified agents only.',
    )
    .addTag(
      'Handovers',
      'The step between a farmer marking an order READY and logistics collecting it. The agent whose cluster holds the farm checks the goods (verify), then records who took them (complete), which ships the order. Verified agents only.',
    )
    .addTag(
      'Messages',
      "Text conversations between an order's buyer and its agent, one per order. Open from payment until the order is fulfilled or cancelled, then read-only. Live updates arrive over socket.io at /v1/chat (WebSocket transport, auth: { token: <Firebase ID token> }): message.created carries a Message, conversation.read carries a ConversationReadEvent.",
    )
    .addTag(
      'Bank accounts',
      "Where a farmer's payouts go. A farmer sets their own; an agent can set one for a farmer in their cluster. The account is checked with Paystack, and any change holds the farmer's payouts for 24 hours.",
    )
    .addTag(
      'Payouts',
      'Paying farmers for fulfilled, paid orders once the hold period has passed. Farmers see their own payouts; admins see who is due and send them as one Paystack bulk transfer.',
    )
    .build();
  return SwaggerModule.createDocument(app, config, {
    // On by default in v11; it would add a "Farm" tag beside each route's own
    // @ApiTags, since FarmController serves both Farms and Farmers.
    autoTagControllers: false,
    // Emitted by HttpExceptionFilter, not by any route, so register it here.
    extraModels: [ErrorResponseDto, ConversationReadEventDto],
  });
}
