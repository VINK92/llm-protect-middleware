import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '@app/shared';

import { IEmbeddingProvider } from './embedding.service';

/**
 * Deterministic hash-derived pseudo-embedding for dev / CI / tests.
 *
 * NOT semantically meaningful — semantically close prompts produce
 * uncorrelated vectors. Used as a placeholder so the cascade architecture
 * is fully wired and testable end-to-end without downloading an ONNX model.
 *
 * Swap to OnnxEmbeddingProvider in production (EMBEDDING_PROVIDER=onnx).
 */
@Injectable()
export class MockEmbeddingProvider implements IEmbeddingProvider {
  readonly dim: number;
  readonly name = 'mock-hash';

  constructor(cfg: ConfigService<AppConfig, true>) {
    this.dim = Number(cfg.get('EMBEDDING_DIM'));
  }

  async embed(text: string): Promise<number[]> {
    const seed = createHash('sha256').update(text, 'utf8').digest();
    const out = new Array<number>(this.dim);

    // Spread bytes deterministically into a `dim`-length float vector in [-1, 1].
    for (let i = 0; i < this.dim; i++) {
      const byte = seed[i % seed.length];
      out[i] = byte / 127.5 - 1;
    }
    // L2-normalize so cosineSimilarity == dot product.
    let norm = 0;
    for (const v of out) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dim; i++) out[i] /= norm;
    return out;
  }
}
