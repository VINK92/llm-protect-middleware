import { Inject, Injectable } from '@nestjs/common';

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export interface IEmbeddingProvider {
  /** Returns L2-normalized vector of length `dim`. */
  embed(text: string): Promise<number[]>;
  readonly dim: number;
  readonly name: string;
}

/**
 * Façade over a pluggable embedding provider.
 *
 * Two implementations:
 *   - MockEmbeddingProvider — hash-based deterministic vector (dev/CI/tests)
 *   - (future) OnnxEmbeddingProvider — real ONNX runtime + sentence-transformer
 *
 * Selected via env-var EMBEDDING_PROVIDER. PRD §FR-2.2: this is the
 * most expensive local computation — must NEVER run before Stages 1–4 pass.
 */
@Injectable()
export class EmbeddingService {
  constructor(@Inject(EMBEDDING_PROVIDER) private readonly provider: IEmbeddingProvider) {}

  embed(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  get dim(): number {
    return this.provider.dim;
  }

  get name(): string {
    return this.provider.name;
  }

  /** Cosine similarity for two L2-normalized vectors. */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
  }
}
