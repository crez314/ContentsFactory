import { Injectable } from '@nestjs/common';
import type { TaskKind } from '@cf/domain';
import type { JobEnvelope } from '@cf/queue';
import { SelectionProcessor } from './selection.processor';
import { BlueprintProcessor } from './blueprint.processor';
import { ImageGenerationProcessor } from './image-generation.processor';
import { VideoGenerationProcessor } from './video-generation.processor';
import { RenderProcessor } from './render.processor';
import { QcProcessor } from './qc.processor';
import { PublishProcessor } from './publish.processor';

export interface TaskProcessor {
  process(envelope: JobEnvelope): Promise<unknown>;
}

@Injectable()
export class ProcessorRegistry {
  private readonly map: Record<TaskKind, TaskProcessor>;

  constructor(
    selection: SelectionProcessor,
    blueprint: BlueprintProcessor,
    image: ImageGenerationProcessor,
    video: VideoGenerationProcessor,
    render: RenderProcessor,
    qc: QcProcessor,
    publish: PublishProcessor,
  ) {
    this.map = {
      SELECTION: selection,
      BLUEPRINT: blueprint,
      GENERATE_IMAGE: image,
      GENERATE_VIDEO: video,
      RENDER: render,
      QC: qc,
      PUBLISH: publish,
    };
  }

  get(kind: TaskKind): TaskProcessor {
    const p = this.map[kind];
    if (!p) throw new Error(`no processor registered for task kind: ${kind}`);
    return p;
  }
}
