export * from './user.entity';
export * from './audit-log.entity';
export * from './system-flag.entity';
export * from './artist.entity';
export * from './asset.entity';
export * from './asset-license.entity';
export * from './channel.entity';
export * from './agent.entity';
export * from './order.entity';
export * from './selection.entity';
export * from './blueprint.entity';
export * from './content.entity';
export * from './scene.entity';
export * from './generated-asset.entity';
export * from './asset-usage.entity';
export * from './qc-result.entity';
export * from './approval.entity';
export * from './publication.entity';
export * from './analytics-snapshot.entity';
export * from './task.entity';
export * from './task-event.entity';
export * from './cost-log.entity';
export * from './master.entity';
export * from './coverage-gap.entity';
export * from './channel-health-log.entity';

import { User } from './user.entity';
import { AuditLog } from './audit-log.entity';
import { SystemFlag } from './system-flag.entity';
import { Artist } from './artist.entity';
import { Asset } from './asset.entity';
import { AssetLicense } from './asset-license.entity';
import { Channel } from './channel.entity';
import { Agent } from './agent.entity';
import { Order } from './order.entity';
import { Selection } from './selection.entity';
import { Blueprint } from './blueprint.entity';
import { Content } from './content.entity';
import { Scene } from './scene.entity';
import { GeneratedAsset } from './generated-asset.entity';
import { AssetUsage } from './asset-usage.entity';
import { QcResult } from './qc-result.entity';
import { Approval } from './approval.entity';
import { Publication } from './publication.entity';
import { AnalyticsSnapshot } from './analytics-snapshot.entity';
import { Task } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { CostLog } from './cost-log.entity';
import { MasterAttributeValue, MasterBannedTerm } from './master.entity';
import { CoverageGap } from './coverage-gap.entity';
import { ChannelHealthLog } from './channel-health-log.entity';

export const ALL_ENTITIES = [
  User, AuditLog, SystemFlag, Artist, Asset, AssetLicense, Channel, Agent,
  Order, Selection, Blueprint, Content, Scene, GeneratedAsset, AssetUsage,
  QcResult, Approval, Publication, AnalyticsSnapshot, Task, TaskEvent, CostLog,
  MasterAttributeValue, MasterBannedTerm, CoverageGap, ChannelHealthLog,
];
