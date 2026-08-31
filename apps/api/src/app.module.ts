import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '@cf/domain';
import { config, JwtAuthGuard, RolesGuard } from '@cf/common';
import { StorageService } from '@cf/storage';
import { CostGuardService, ModelRegistry, NotifierService, registerBackends } from '@cf/model-abstraction';

import { AuthModule } from './auth/auth.module';
import { UsersController } from './auth/users.controller';
import { AssetModule } from './asset/asset.module';
import { ArtistController } from './artist/artist.controller';
import { OrderModule } from './order/order.module';
import { ContentModule } from './content/content.module';
import { TaskModule } from './task/task.module';
import { AgentController } from './agent/agent.controller';
import { ChannelController } from './channel/channel.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { SystemController } from './system/system.controller';
import { MasterController } from './master/master.controller';
import { FilesController } from './files/files.controller';

import { AppExceptionFilter } from './common/exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { AuditService } from './common/audit.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: config.db.url,
      entities: ALL_ENTITIES,
      synchronize: false,
      logging: config.logLevel === 'debug' ? ['query', 'error'] : ['error'],
      extra: { max: config.db.poolMax },
    }),
    AuthModule,
    TaskModule,
    AssetModule,
    OrderModule,
    ContentModule,
  ],
  controllers: [
    UsersController,
    ArtistController,
    AgentController,
    ChannelController,
    DashboardController,
    SystemController,
    MasterController,
    FilesController,
  ],
  providers: [
    StorageService,
    AuditService,
    NotifierService,
    CostGuardService,
    {
      // 어댑터 등록은 부팅 시 한 번. 벤더 선택은 여기서만 일어난다 (§4.5).
      provide: ModelRegistry,
      useFactory: (storage: StorageService) => registerBackends(new ModelRegistry(), storage),
      inject: [StorageService],
    },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
