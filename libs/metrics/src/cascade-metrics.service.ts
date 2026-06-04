import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Histogram } from 'prom-client';

import { DetectionStage } from '@app/shared';

import { PrometheusRegistryService } from './prometheus-registry.service';

/**
 * Per-cascade-stage Prometheus instrumentation.
 *
 * Critical metrics for PRD §13 Acceptance Criteria:
 *   - llm_protect_embedding_computed_total  ──┐
 *   - llm_protect_passed_stage_total{stage=4} ─┴── these MUST correlate
 *     to prove FR-2.2 (embedding only after stages 1a–4 pass).
 */
@Injectable()
export class CascadeMetricsService implements OnModuleInit {
  private stageLatency!: Histogram<string>;
  private blocked!: Counter<string>;
  private passed!: Counter<string>;
  private cacheHits!: Counter<string>;
  private embeddingComputed!: Counter<string>;

  constructor(private readonly registry: PrometheusRegistryService) {}

  onModuleInit(): void {
    const reg = this.registry.registry;

    this.stageLatency = new Histogram({
      name: 'llm_protect_stage_latency_ms',
      help: 'Latency of each cascade stage in milliseconds',
      labelNames: ['stage'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000],
      registers: [reg],
    });

    this.blocked = new Counter({
      name: 'llm_protect_blocked_total',
      help: 'Requests blocked by a given cascade stage',
      labelNames: ['stage'],
      registers: [reg],
    });

    this.passed = new Counter({
      name: 'llm_protect_passed_stage_total',
      help: 'Requests that passed a given cascade stage',
      labelNames: ['stage'],
      registers: [reg],
    });

    this.cacheHits = new Counter({
      name: 'llm_protect_cache_hits_total',
      help: 'Cache hits by type (exact / semantic)',
      labelNames: ['type'],
      registers: [reg],
    });

    this.embeddingComputed = new Counter({
      name: 'llm_protect_embedding_computed_total',
      help: 'Total ONNX embeddings computed (Stage 5 reached)',
      registers: [reg],
    });
  }

  observeStage(stage: DetectionStage, latencyMs: number): void {
    this.stageLatency.labels(stage).observe(latencyMs);
    this.passed.labels(stage).inc();
  }

  incBlocked(stage: DetectionStage): void {
    this.blocked.labels(stage).inc();
  }

  incCacheHit(type: 'exact' | 'semantic'): void {
    this.cacheHits.labels(type).inc();
  }

  incEmbeddingComputed(): void {
    this.embeddingComputed.inc();
  }
}
