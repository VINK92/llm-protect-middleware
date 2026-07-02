import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ort from 'onnxruntime-node';

import { AppConfig } from '@app/shared';

import { IEmbeddingProvider } from './embedding.service';

interface TokenizerJson {
  model: {
    type: string;
    vocab: Record<string, number>;
  };
}

/**
 * Real ONNX-based embedding provider using all-MiniLM-L6-v2.
 *
 * Loads the ONNX model + WordPiece vocabulary on init,
 * tokenises input text, runs inference, and mean-pools
 * the last hidden state into a 384-dim L2-normalised vector.
 */
@Injectable()
export class OnnxEmbeddingProvider implements IEmbeddingProvider, OnModuleInit {
  private readonly logger = new Logger(OnnxEmbeddingProvider.name);

  readonly dim: number;
  readonly name = 'onnx-all-MiniLM-L6-v2';

  private session!: ort.InferenceSession;
  private vocab!: Map<string, number>;
  private readonly modelPath: string;
  private readonly maxLength = 128;

  // Special token IDs (BERT-style)
  private clsId = 101;
  private sepId = 102;
  private padId = 0;

  constructor(cfg: ConfigService<AppConfig, true>) {
    this.dim = Number(cfg.get('EMBEDDING_DIM'));
    this.modelPath = String(cfg.get('EMBEDDING_MODEL_PATH'));
  }

  async onModuleInit(): Promise<void> {
    const modelDir = join(process.cwd(), this.modelPath, '..');
    const modelFile = join(process.cwd(), this.modelPath);

    // Load vocabulary from tokenizer.json
    const tokenizerPath = join(modelDir, 'tokenizer.json');
    const tokenizerJson = JSON.parse(
      readFileSync(tokenizerPath, 'utf8'),
    ) as TokenizerJson;
    this.vocab = new Map(Object.entries(tokenizerJson.model.vocab));

    this.clsId = this.vocab.get('[CLS]') ?? 101;
    this.sepId = this.vocab.get('[SEP]') ?? 102;
    this.padId = this.vocab.get('[PAD]') ?? 0;

    // Create ONNX session
    this.session = await ort.InferenceSession.create(modelFile, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });

    this.logger.log(
      `ONNX model loaded: ${this.name} (dim=${this.dim}, vocab=${this.vocab.size})`,
    );
  }

  async embed(text: string): Promise<number[]> {
    const tokenIds = this.tokenize(text);
    const seqLen = tokenIds.length;

    const inputIds = new BigInt64Array(tokenIds.map((id) => BigInt(id)));
    const attentionMask = new BigInt64Array(
      tokenIds.map((id) => (id !== this.padId ? 1n : 0n)),
    );
    const tokenTypeIds = new BigInt64Array(seqLen).fill(0n);

    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', inputIds, [1, seqLen]),
      attention_mask: new ort.Tensor('int64', attentionMask, [1, seqLen]),
      token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, seqLen]),
    };

    const result = await this.session.run(feeds);
    const hiddenState = result['last_hidden_state'];
    const data = hiddenState.data as Float32Array;

    // Mean pooling over non-padding tokens
    const embedding = this.meanPool(data, seqLen, attentionMask);

    // L2-normalise
    let norm = 0;
    for (const v of embedding) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < embedding.length; i++) embedding[i] /= norm;

    return Array.from(embedding);
  }

  /**
   * Minimal WordPiece tokenizer:
   *  1. Lowercase + strip accents
   *  2. Split on whitespace + punctuation
   *  3. WordPiece sub-word lookup
   *  4. Wrap with [CLS] ... [SEP], pad/truncate to maxLength
   */
  private tokenize(text: string): number[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' $& ')
      .split(/\s+/)
      .filter(Boolean);

    const tokens: number[] = [this.clsId];

    for (const word of words) {
      if (tokens.length >= this.maxLength - 1) break;
      const subTokens = this.wordPiece(word);
      for (const id of subTokens) {
        if (tokens.length >= this.maxLength - 1) break;
        tokens.push(id);
      }
    }

    tokens.push(this.sepId);

    // Pad to maxLength
    while (tokens.length < this.maxLength) {
      tokens.push(this.padId);
    }

    return tokens;
  }

  private wordPiece(word: string): number[] {
    const ids: number[] = [];
    let start = 0;

    while (start < word.length) {
      let end = word.length;
      let found = false;

      while (start < end) {
        const sub = start === 0 ? word.slice(start, end) : '##' + word.slice(start, end);
        const id = this.vocab.get(sub);
        if (id !== undefined) {
          ids.push(id);
          start = end;
          found = true;
          break;
        }
        end--;
      }

      if (!found) {
        // Unknown token [UNK] = 100
        ids.push(this.vocab.get('[UNK]') ?? 100);
        start++;
      }
    }

    return ids;
  }

  private meanPool(
    data: Float32Array,
    seqLen: number,
    mask: BigInt64Array,
  ): Float64Array {
    const pooled = new Float64Array(this.dim);
    let count = 0;

    for (let i = 0; i < seqLen; i++) {
      if (mask[i] === 0n) continue;
      count++;
      const offset = i * this.dim;
      for (let j = 0; j < this.dim; j++) {
        pooled[j] += data[offset + j];
      }
    }

    if (count > 0) {
      for (let j = 0; j < this.dim; j++) pooled[j] /= count;
    }

    return pooled;
  }
}
