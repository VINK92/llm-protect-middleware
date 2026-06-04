import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig, RequestContext, StageResult } from '@app/shared';

/**
 * FR-3: aggregates per-stage risk scores into a final 0..100 number.
 * Formula (from PRD §FR-3.1):
 *   risk_score = w1 * token_count_norm
 *              + w2 * frequency_norm
 *              + w3 * repetition_norm
 *              + w4 * entropy_norm
 *
 * Weights are read from config (env-vars) — FR-3.2.
 */
@Injectable()
export class RiskScoreService {
  private readonly weights: {
    tokenCount: number;
    frequency: number;
    repetition: number;
    entropy: number;
  };

  constructor(cfg: ConfigService<AppConfig, true>) {
    this.weights = {
      tokenCount: Number(cfg.get('RISK_WEIGHT_TOKEN_COUNT')),
      frequency: Number(cfg.get('RISK_WEIGHT_FREQUENCY')),
      repetition: Number(cfg.get('RISK_WEIGHT_REPETITION')),
      entropy: Number(cfg.get('RISK_WEIGHT_ENTROPY')),
    };
  }

  record(ctx: RequestContext, result: StageResult): void {
    ctx.stages.push(result);
  }

  finalize(ctx: RequestContext): number {
    const tokenScore = this.normalize(ctx.tokenCount ?? 0, 0, 8000) * 100;
    const freqScore = this.byStage(ctx, 'RATE_LIMIT');
    const repScore = this.byStage(ctx, 'EXACT_CACHE');
    const entScore = this.byStage(ctx, 'ENTROPY');

    const score =
      this.weights.tokenCount * tokenScore +
      this.weights.frequency * freqScore +
      this.weights.repetition * repScore +
      this.weights.entropy * entScore;

    ctx.totalRiskScore = Math.min(100, Math.max(0, Math.round(score)));
    return ctx.totalRiskScore;
  }

  private byStage(ctx: RequestContext, stage: string): number {
    const r = ctx.stages.find((s) => s.stage === stage);
    return r?.risk_score ?? 0;
  }

  private normalize(value: number, min: number, max: number): number {
    if (max === min) return 0;
    return Math.min(1, Math.max(0, (value - min) / (max - min)));
  }
}
