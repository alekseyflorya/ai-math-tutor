import { Injectable, NestMiddleware, UnsupportedMediaTypeException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * CSRF defence in depth on top of SameSite=Lax cookies: state-changing requests must
 * be JSON. HTML forms cannot send application/json cross-site without a CORS preflight,
 * and this API enables no CORS at all (the web app is served from the same origin).
 */
@Injectable()
export class JsonOnlyMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
      throw new UnsupportedMediaTypeException({
        code: 'JSON_REQUIRED',
        message: 'Content-Type must be application/json',
      });
    }
    next();
  }
}
