import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const CHAT_ROLES = ['system', 'user', 'assistant'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export class ChatMessageDto {
  @ApiProperty({ enum: CHAT_ROLES, example: 'user' })
  @IsString()
  @IsIn(CHAT_ROLES as unknown as string[])
  role!: ChatRole;

  @ApiProperty({ example: 'Hello, how are you?' })
  @IsString()
  @MaxLength(64_000)
  content!: string;
}

/**
 * OpenAI-compatible chat completion request body.
 * Validated via NestJS ValidationPipe + class-validator (FR-1.5).
 */
export class ChatCompletionDto {
  @ApiProperty({ example: 'llama3.2' })
  @IsString()
  model!: string;

  @ApiProperty({ type: [ChatMessageDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @ApiProperty({ required: false, default: 0.7, minimum: 0, maximum: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiProperty({ required: false, example: 1024 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(32_000)
  max_tokens?: number;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  stream?: boolean;
}

export class ChatCompletionChoiceDto {
  @ApiProperty()
  index!: number;

  @ApiProperty({ type: ChatMessageDto })
  message!: ChatMessageDto;

  @ApiProperty({ required: false })
  finish_reason?: string;
}

export class ChatCompletionUsageDto {
  @ApiProperty()
  prompt_tokens!: number;

  @ApiProperty()
  completion_tokens!: number;

  @ApiProperty()
  total_tokens!: number;
}

export class ChatCompletionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'chat.completion' })
  object!: string;

  @ApiProperty()
  created!: number;

  @ApiProperty()
  model!: string;

  @ApiProperty({ type: [ChatCompletionChoiceDto] })
  choices!: ChatCompletionChoiceDto[];

  @ApiProperty({ type: ChatCompletionUsageDto, required: false })
  usage?: ChatCompletionUsageDto;
}
