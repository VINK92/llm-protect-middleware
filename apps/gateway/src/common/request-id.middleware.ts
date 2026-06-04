import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

import { RequestContext, setRequestContext } from '@app/shared';

/**
 * Bootstraps the per-request RequestContext used by every cascade stage.
 * Runs FIRST in the pipeline (before any guard/interceptor).
 *
 * Note: under Fastify adapter, middleware receives `request.raw`. We
 * mirror ctx onto both raw and wrapper via setRequestContext so
 * downstream guards/interceptors/controllers can read it uniformly.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void): void {
    const headerId = req.headers['x-request-id'];
    const requestId =
      typeof headerId === 'string' && headerId.length > 0 ? headerId : `req_${uuidv4()}`;

    const clientId =
      (req.headers['x-api-key'] as string | undefined) ?? req.socket.remoteAddress ?? 'unknown';

    const ctx: RequestContext = {
      requestId,
      clientId,
      stages: [],
      totalRiskScore: 0,
      startedAt: Date.now(),
    };

    setRequestContext(req, ctx);
    res.setHeader('x-request-id', requestId);
    next();
  }
}
