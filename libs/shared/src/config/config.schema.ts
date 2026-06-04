import * as Joi from 'joi';

/**
 * Joi validation schema for env-vars (FR-NFR-7).
 * Loaded by ConfigModule.forRoot({ validationSchema }).
 */
export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error', 'fatal').default('info'),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().min(0).max(15).default(0),

  // AI backend
  AI_BACKEND: Joi.string().valid('ollama', 'mock').default('mock'),
  OLLAMA_BASE_URL: Joi.string().uri().default('http://localhost:11434'),
  OLLAMA_MODEL: Joi.string().default('llama3.2'),

  // Stage 1a
  STAGE_CONTENT_LENGTH_ENABLED: Joi.boolean().default(true),
  STAGE_CONTENT_LENGTH_MAX_BYTES: Joi.number().integer().min(1).default(1_048_576),

  // Stage 1b
  STAGE_RATE_LIMIT_ENABLED: Joi.boolean().default(true),
  STAGE_RATE_LIMIT_WINDOW_SEC: Joi.number().integer().min(1).default(60),
  STAGE_RATE_LIMIT_MAX_REQUESTS: Joi.number().integer().min(1).default(100),

  // Stage 2
  STAGE_EXACT_CACHE_ENABLED: Joi.boolean().default(true),
  STAGE_EXACT_CACHE_TTL_SEC: Joi.number().integer().min(1).default(3600),

  // Stage 3
  STAGE_ENTROPY_ENABLED: Joi.boolean().default(true),
  STAGE_ENTROPY_MIN: Joi.number().min(0).max(8).default(1.5),
  STAGE_ENTROPY_MAX: Joi.number().min(0).max(8).default(6.0),
  STAGE_ENTROPY_MIN_LENGTH: Joi.number().integer().min(1).default(20),

  // Stage 4
  STAGE_TOKEN_LIMIT_ENABLED: Joi.boolean().default(true),
  STAGE_TOKEN_LIMIT_MAX_TOKENS: Joi.number().integer().min(1).default(8000),

  // Stage 5
  STAGE_SEMANTIC_CACHE_ENABLED: Joi.boolean().default(true),
  STAGE_SEMANTIC_CACHE_THRESHOLD: Joi.number().min(0).max(1).default(0.95),
  STAGE_SEMANTIC_CACHE_TTL_SEC: Joi.number().integer().min(1).default(3600),
  EMBEDDING_PROVIDER: Joi.string().valid('mock', 'onnx').default('mock'),
  EMBEDDING_MODEL_PATH: Joi.string().default('./models/all-MiniLM-L6-v2.onnx'),
  EMBEDDING_DIM: Joi.number().integer().min(1).default(384),

  // Adaptive rate limit
  RL_TOKEN_BUDGET_PER_MIN: Joi.number().integer().min(1).default(10_000),
  RL_ADAPTIVE_ENABLED: Joi.boolean().default(true),
  RL_CPU_THRESHOLD: Joi.number().integer().min(1).max(100).default(80),

  // Risk weights
  RISK_WEIGHT_TOKEN_COUNT: Joi.number().min(0).max(1).default(0.3),
  RISK_WEIGHT_FREQUENCY: Joi.number().min(0).max(1).default(0.3),
  RISK_WEIGHT_REPETITION: Joi.number().min(0).max(1).default(0.2),
  RISK_WEIGHT_ENTROPY: Joi.number().min(0).max(1).default(0.2),
});
