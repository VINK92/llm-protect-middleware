import { ConfigService } from '@nestjs/config';

import { AppConfig } from '@app/shared';

import { MockEmbeddingProvider } from './embedding.mock';
import { EmbeddingService } from './embedding.service';

const buildConfig = (dim = 384) =>
  ({
    get: () => dim,
  }) as unknown as ConfigService<AppConfig, true>;

describe('MockEmbeddingProvider (Stage 5 placeholder)', () => {
  const provider = new MockEmbeddingProvider(buildConfig(384));

  it('produces vectors of the configured dimension', async () => {
    const v = await provider.embed('hello world');
    expect(v).toHaveLength(384);
  });

  it('produces L2-normalized vectors (||v|| ≈ 1)', async () => {
    const v = await provider.embed('some prompt text');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic — same input → same vector', async () => {
    const a = await provider.embed('repeatable prompt');
    const b = await provider.embed('repeatable prompt');
    expect(a).toEqual(b);
  });

  it('different inputs → different vectors (sim < 1)', async () => {
    const a = await provider.embed('foo');
    const b = await provider.embed('bar');
    expect(EmbeddingService.cosineSimilarity(a, b)).toBeLessThan(1);
  });

  it('cosineSimilarity of a vector with itself is 1', async () => {
    const a = await provider.embed('self-similarity check');
    expect(EmbeddingService.cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });
});
