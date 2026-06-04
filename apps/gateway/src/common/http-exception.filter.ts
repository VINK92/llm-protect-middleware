import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';

import {
  ERROR_CODES,
  ErrorBody,
  ErrorResponseDto,
  RequestContext,
  getRequestContext,
} from '@app/shared';

/**
 * Global exception filter — wraps every error in the standardized envelope
 * defined by PRD §8.2 / FR-1.4.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<FastifyReply>();
    const req = http.getRequest<FastifyRequest>();

    const ctx = (getRequestContext(req) ?? {}) as Partial<RequestContext>;

    const isHttpEx = exception instanceof HttpException;
    const status = isHttpEx ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = isHttpEx ? exception.getResponse() : undefined;

    const inner =
      raw && typeof raw === 'object' && 'error' in raw
        ? (raw as { error: Partial<ErrorBody> }).error
        : {};

    const body: ErrorBody = {
      code: (inner.code as ErrorBody['code']) ?? ERROR_CODES.INTERNAL_ERROR,
      stage: inner.stage,
      message: inner.message ?? (isHttpEx ? exception.message : 'Unexpected internal error'),
      risk_score: inner.risk_score ?? ctx.totalRiskScore,
      request_id: ctx.requestId ?? 'req_unknown',
    };

    if (!isHttpEx || status >= 500) {
      this.logger.error(
        { exception: serializeError(exception), request_id: body.request_id },
        body.message,
      );
    } else {
      this.logger.warn({ request_id: body.request_id, status, code: body.code }, body.message);
    }

    const envelope: ErrorResponseDto = { error: body };
    res.status(status).send(envelope);
  }
}

function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { value: String(e) };
}
