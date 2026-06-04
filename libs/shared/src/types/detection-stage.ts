/**
 * Cascade stages per PRD §FR-2.
 * Ordering reflects "cheapest → most expensive" principle.
 */
export enum DetectionStage {
  CONTENT_LENGTH = 'CONTENT_LENGTH', // Stage 1a — instant int check
  RATE_LIMIT = 'RATE_LIMIT', // Stage 1b — Redis lookup
  EXACT_CACHE = 'EXACT_CACHE', // Stage 2 — SHA-256 + Redis GET
  ENTROPY = 'ENTROPY', // Stage 3 — Shannon entropy
  TOKEN_LIMIT = 'TOKEN_LIMIT', // Stage 4 — tiktoken
  SEMANTIC_CACHE = 'SEMANTIC_CACHE', // Stage 5 — ONNX embedding + vector search
}

/**
 * Per-stage result reported back to the RiskScoreService.
 */
export interface StageResult {
  stage: DetectionStage;
  passed: boolean;
  risk_score: number; // 0..100
  latency_ms?: number;
  details?: Record<string, unknown>;
}

export const STAGE_HTTP_CODE: Record<DetectionStage, number> = {
  [DetectionStage.CONTENT_LENGTH]: 413,
  [DetectionStage.RATE_LIMIT]: 429,
  [DetectionStage.EXACT_CACHE]: 200, // hit returns cached response
  [DetectionStage.ENTROPY]: 400,
  [DetectionStage.TOKEN_LIMIT]: 413,
  [DetectionStage.SEMANTIC_CACHE]: 200,
};
