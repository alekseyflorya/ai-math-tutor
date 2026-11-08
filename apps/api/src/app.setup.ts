import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/** HTTP-level setup shared by main.ts and the e2e tests. */
export function configureApp(app: NestExpressApplication): void {
  // Behind Caddy: trust exactly one proxy hop so rate limits see the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '20kb' });
  app.setGlobalPrefix('api');
  // No CORS: the web app is served from the same origin (Vite proxy in dev, Caddy in prod).
}
