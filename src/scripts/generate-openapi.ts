import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from '../openapi';

async function generate() {
  // Preview mode resolves the module graph without instantiating providers,
  // and there's no init/listen, so no DB, Redis or Firebase credentials needed.
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  const document = buildOpenApiDocument(app);
  // Trailing newline + stable indent keeps diffs down to real API changes.
  const target = resolve(process.cwd(), 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`Wrote ${target}`);
}
void generate();
