import { Module } from '@nestjs/common';

import { AiProxyModule } from '@app/ai-proxy';
import { DetectionEngineModule } from '@app/detection-engine';
import { SemanticCacheModule } from '@app/semantic-cache';

import { ChatController } from './chat.controller';

@Module({
  imports: [DetectionEngineModule, SemanticCacheModule, AiProxyModule],
  controllers: [ChatController],
})
export class ChatModule {}
