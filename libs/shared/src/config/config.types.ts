/**
 * Strongly-typed view over `ConfigService`.
 * Mirrors keys validated by configValidationSchema.
 */
export interface AppConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  LOG_LEVEL: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  REDIS_DB: number;

  AI_BACKEND: 'ollama' | 'mock';
  OLLAMA_BASE_URL: string;
  OLLAMA_MODEL: string;

  STAGE_CONTENT_LENGTH_ENABLED: boolean;
  STAGE_CONTENT_LENGTH_MAX_BYTES: number;

  STAGE_RATE_LIMIT_ENABLED: boolean;
  STAGE_RATE_LIMIT_WINDOW_SEC: number;
  STAGE_RATE_LIMIT_MAX_REQUESTS: number;

  STAGE_EXACT_CACHE_ENABLED: boolean;
  STAGE_EXACT_CACHE_TTL_SEC: number;

  STAGE_ENTROPY_ENABLED: boolean;
  STAGE_ENTROPY_MIN: number;
  STAGE_ENTROPY_MAX: number;
  STAGE_ENTROPY_MIN_LENGTH: number;

  STAGE_TOKEN_LIMIT_ENABLED: boolean;
  STAGE_TOKEN_LIMIT_MAX_TOKENS: number;

  STAGE_SEMANTIC_CACHE_ENABLED: boolean;
  STAGE_SEMANTIC_CACHE_THRESHOLD: number;
  STAGE_SEMANTIC_CACHE_TTL_SEC: number;
  EMBEDDING_PROVIDER: 'mock' | 'onnx';
  EMBEDDING_MODEL_PATH: string;
  EMBEDDING_DIM: number;

  RL_TOKEN_BUDGET_PER_MIN: number;
  RL_ADAPTIVE_ENABLED: boolean;
  RL_CPU_THRESHOLD: number;

  RISK_WEIGHT_TOKEN_COUNT: number;
  RISK_WEIGHT_FREQUENCY: number;
  RISK_WEIGHT_REPETITION: number;
  RISK_WEIGHT_ENTROPY: number;
}
