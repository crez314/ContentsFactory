import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '@cf/domain';
import { config } from '@cf/common';
import { StorageService } from '@cf/storage';
import {
  CostGuardService, GenerationService, ModelRegistry, NotifierService, registerBackends,
} from '@cf/model-abstraction';

import { WorkerRunner } from './worker-runner.service';
import { ProcessorRegistry } from './processors/processor.registry';
import { SelectionProcessor } from './processors/selection.processor';
import { BlueprintProcessor } from './processors/blueprint.processor';
import { ImageGenerationProcessor } from './processors/image-generation.processor';
import { VideoGenerationProcessor } from './processors/video-generation.processor';
import { RenderProcessor } from './processors/render.processor';
import { QcProcessor } from './processors/qc.processor';
import { PublishProcessor } from './processors/publish.processor';
import { IdentityService } from './generation/identity.service';
import { CaptionService } from './generation/caption.service';
import { QcEngineService } from './qc/qc-engine.service';
import { ChannelOptimizerService } from './publish/channel-optimizer.service';
import { CredentialsService } from './publish/credentials.service';
import { ProvenanceService } from './publish/provenance.service';
import { ChannelHealthService } from '@cf/orchestration';
import { AutoTagService } from './tagging/auto-tag.service';
import { HeartbeatService } from './heartbeat.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: config.db.url,
      entities: ALL_ENTITIES,
      synchronize: false,
      logging: ['error'],
      extra: { max: 15 },
    }),
  ],
  providers: [
    StorageService,
    NotifierService,
    CostGuardService,
    {
      provide: ModelRegistry,
      useFactory: (storage: StorageService) => registerBackends(new ModelRegistry(), storage),
      inject: [StorageService],
    },
    GenerationService,
    IdentityService,
    CaptionService,
    QcEngineService,
    ChannelOptimizerService,
    CredentialsService,
    ProvenanceService,
    ChannelHealthService,
    SelectionProcessor,
    BlueprintProcessor,
    ImageGenerationProcessor,
    VideoGenerationProcessor,
    RenderProcessor,
    QcProcessor,
    PublishProcessor,
    ProcessorRegistry,
    WorkerRunner,
    AutoTagService,
    HeartbeatService,
  ],
})
export class WorkerModule {}
