import { DetectionStage, StageResult } from './detection-stage';

/**
 * Per-request mutable context attached to the request object.
 * Populated by middleware/guards/interceptors as the request travels the cascade.
 */
export interface RequestContext {
  /** Correlation ID (UUID v4) populated by RequestIdMiddleware. */
  requestId: string;

  /** Client identifier — IP, API key, or fingerprint. */
  clientId: string;

  /** Concatenated prompt text used for hashing/entropy/tokenization. */
  promptText?: string;

  /** SHA-256 hex of the canonical prompt (set on Stage 2). */
  promptHash?: string;

  /** Token count from tiktoken (set on Stage 4). */
  tokenCount?: number;

  /** Embedding vector (set on Stage 5 if reached). */
  embedding?: number[];

  /** Per-stage results, in execution order. */
  stages: StageResult[];

  /** Final stage reached before completion/blocking. */
  finalStage?: DetectionStage | 'AI_INFERENCE';

  /** Aggregated risk score (0..100). */
  totalRiskScore: number;

  /** Set to true if response was served from cache (exact or semantic). */
  cacheHit?: 'exact' | 'semantic' | false;

  /** Wall-clock start timestamp (ms). */
  startedAt: number;
}

export const REQUEST_CONTEXT_KEY = 'ctx';

/**
 * Cross-adapter accessor for the RequestContext.
 *
 * Why: NestJS middleware under the Fastify adapter receives `request.raw`
 * (the native IncomingMessage), while Guards/Interceptors/Controllers
 * receive the FastifyRequest WRAPPER. The wrapper and its `.raw` are
 * DIFFERENT objects — a property set on one is not visible on the other.
 *
 * These helpers transparently read/write from both locations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRequestContext(req: any): RequestContext | undefined {
  if (!req) return undefined;
  return req[REQUEST_CONTEXT_KEY] ?? req.raw?.[REQUEST_CONTEXT_KEY];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setRequestContext(req: any, ctx: RequestContext): void {
  if (!req) return;
  req[REQUEST_CONTEXT_KEY] = ctx;
  if (req.raw) req.raw[REQUEST_CONTEXT_KEY] = ctx;
}
