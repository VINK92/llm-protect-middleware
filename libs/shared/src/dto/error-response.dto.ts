import { ApiProperty } from '@nestjs/swagger';
import { DetectionStage } from '../types/detection-stage';

export const ERROR_CODES = {
  MDOS_DETECTED: 'MDOS_DETECTED',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  TOKEN_LIMIT_EXCEEDED: 'TOKEN_LIMIT_EXCEEDED',
  HIGH_ENTROPY_GARBAGE: 'HIGH_ENTROPY_GARBAGE',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Standardized error envelope (FR-1.4 / §8.2 of PRD).
 * Returned by HttpExceptionFilter for every blocked or failed request.
 */
export class ErrorBody {
  @ApiProperty({ enum: ERROR_CODES })
  code!: ErrorCode;

  @ApiProperty({ required: false, enum: DetectionStage })
  stage?: DetectionStage;

  @ApiProperty()
  message!: string;

  @ApiProperty({ required: false, minimum: 0, maximum: 100 })
  risk_score?: number;

  @ApiProperty()
  request_id!: string;
}

export class ErrorResponseDto {
  @ApiProperty({ type: ErrorBody })
  error!: ErrorBody;
}
