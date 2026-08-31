import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '@cf/domain';
import { config } from '@cf/common';
import { NotifierService } from '@cf/model-abstraction';
import { ApprovalService, OrchestratorService, TaskFactory } from '@cf/orchestration';
import { OrchestrateConsumer } from './orchestrate.consumer';
import { FailureHandlerService } from './failure-handler.service';
import { SlaMonitorService } from './sla-monitor.service';
import { HeartbeatService } from './heartbeat.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: config.db.url,
      entities: ALL_ENTITIES,
      synchronize: false,
      logging: ['error'],
      extra: { max: 10 },
    }),
  ],
  providers: [
    TaskFactory,
    ApprovalService,
    OrchestratorService,
    NotifierService,
    FailureHandlerService,
    SlaMonitorService,
    OrchestrateConsumer,
    HeartbeatService,
  ],
})
export class OrchestratorModule {}
