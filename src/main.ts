import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { requireConfig } from './common/config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { buildOpenApiDocument } from './openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Explicit allowlist, never a wildcard. Auth is a bearer header, not a
  // cookie, so credentials stay off.
  const origins = requireConfig(app.get(ConfigService), 'FRONTEND_WEBAPP_URL')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: false });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('v1/docs', app, document, {
    jsonDocumentUrl: 'v1/docs.json',
    yamlDocumentUrl: 'v1/docs.yaml',
    // Keeps the pasted bearer token across page reloads.
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 8080;
  await app.listen(port);
  if (['development', 'staging'].includes(process.env.NODE_ENV ?? '')) {
    const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;
    const logger = new Logger('Bootstrap');
    logger.log(`laicos server is running on: ${baseUrl}`);
    logger.log(`API documentation: ${baseUrl}/v1/docs`);
  }
}
void bootstrap();
