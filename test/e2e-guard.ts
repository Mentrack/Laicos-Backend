import 'dotenv/config';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// The e2e specs create and delete rows directly, and .env may point at a
// shared remote database, so refuse anything but a local one before any
// spec connects.
export default function guardE2eDatabase() {
  if (process.env.E2E_ALLOW_REMOTE_DB === '1') {
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('E2E tests need DATABASE_URL pointing at a local database');
  }
  const { hostname } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing to run e2e tests against DATABASE_URL host "${hostname}". ` +
        'Point it at the docker database, e.g. ' +
        'DATABASE_URL=postgresql://laicos:laicos@localhost:5434/laicos, ' +
        'or set E2E_ALLOW_REMOTE_DB=1 if you really mean it.',
    );
  }
}
