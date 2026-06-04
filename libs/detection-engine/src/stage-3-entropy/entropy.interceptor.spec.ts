import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom, of } from 'rxjs';

import { CascadeMetricsService } from '@app/metrics';
import { AppConfig, DetectionStage, REQUEST_CONTEXT_KEY, RequestContext } from '@app/shared';

import { EntropyInterceptor } from './entropy.interceptor';

const buildConfig = (overrides: Partial<Record<keyof AppConfig, unknown>> = {}) =>
  ({
    get: (key: string) =>
      ({
        STAGE_ENTROPY_ENABLED: true,
        STAGE_ENTROPY_MIN: 1.5,
        STAGE_ENTROPY_MAX: 7.5,
        STAGE_ENTROPY_MIN_LENGTH: 20,
        ...overrides,
      })[key as string],
  }) as unknown as ConfigService<AppConfig, true>;

const buildMetrics = (): CascadeMetricsService =>
  ({
    observeStage: jest.fn(),
    incBlocked: jest.fn(),
    incCacheHit: jest.fn(),
    incEmbeddingComputed: jest.fn(),
  }) as unknown as CascadeMetricsService;

const buildExec = (ctx: RequestContext): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ [REQUEST_CONTEXT_KEY]: ctx }) }),
  }) as unknown as ExecutionContext;

const passThrough: CallHandler = { handle: () => of('passed') };

const buildCtx = (promptText: string): RequestContext => ({
  requestId: 'req_test',
  clientId: '127.0.0.1',
  promptText,
  stages: [],
  totalRiskScore: 0,
  startedAt: Date.now(),
});

describe('EntropyInterceptor (Stage 3)', () => {
  it('allows normal English text', async () => {
    const intc = new EntropyInterceptor(buildConfig(), buildMetrics());
    const ctx = buildCtx('The quick brown fox jumps over the lazy dog'.repeat(2));
    await expect(lastValueFrom(intc.intercept(buildExec(ctx), passThrough))).resolves.toBe(
      'passed',
    );
    expect(ctx.stages.at(-1)?.passed).toBe(true);
    expect(ctx.stages.at(-1)?.stage).toBe(DetectionStage.ENTROPY);
  });

  it('blocks hyper-random garbage (entropy too high)', () => {
    const intc = new EntropyInterceptor(buildConfig({ STAGE_ENTROPY_MAX: 5 }), buildMetrics());
    const garbage = Array.from({ length: 200 }, (_, i) =>
      String.fromCharCode(32 + (i * 7) % 95),
    ).join('');
    const ctx = buildCtx(garbage);
    expect(() => intc.intercept(buildExec(ctx), passThrough)).toThrow(HttpException);
    expect(ctx.finalStage).toBe(DetectionStage.ENTROPY);
  });

  it('blocks repetitive flood (entropy too low)', () => {
    const intc = new EntropyInterceptor(buildConfig(), buildMetrics());
    const ctx = buildCtx('a'.repeat(100));
    expect(() => intc.intercept(buildExec(ctx), passThrough)).toThrow(HttpException);
    expect(ctx.finalStage).toBe(DetectionStage.ENTROPY);
  });

  it('skips very short prompts (length < minLength)', async () => {
    const intc = new EntropyInterceptor(buildConfig(), buildMetrics());
    const ctx = buildCtx('hi');
    await expect(lastValueFrom(intc.intercept(buildExec(ctx), passThrough))).resolves.toBe(
      'passed',
    );
    expect(ctx.stages).toHaveLength(0);
  });

  it('is a no-op when stage is disabled via config', async () => {
    const intc = new EntropyInterceptor(
      buildConfig({ STAGE_ENTROPY_ENABLED: false }),
      buildMetrics(),
    );
    const ctx = buildCtx('a'.repeat(1000));
    await expect(lastValueFrom(intc.intercept(buildExec(ctx), passThrough))).resolves.toBe(
      'passed',
    );
    expect(ctx.stages).toHaveLength(0);
  });
});
