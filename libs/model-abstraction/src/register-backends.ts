import { config, createLogger } from '@cf/common';
import { StorageService } from '@cf/storage';
import { HttpGenerationBackend } from './backends/http-generic.backend';
import { MockEmbeddingBackend } from './backends/mock-embedding.backend';
import { MockImageBackend } from './backends/mock-image.backend';
import { MockMusicBackend } from './backends/mock-music.backend';
import { MockVideoBackend } from './backends/mock-video.backend';
import { MockVoiceBackend } from './backends/mock-voice.backend';
import { ModelRegistry } from './registry.service';

const log = createLogger('register-backends');

/**
 * §4.5 어댑터 등록 — 환경별 설정.
 * 이 파일과 어댑터 구현체 외에는 어떤 코드도 특정 벤더를 알지 못한다.
 * 모델 교체는 어댑터 하나 추가 + 여기서 우선순위 변경으로 끝난다.
 */
export function registerBackends(registry: ModelRegistry, storage: StorageService): ModelRegistry {
  if (config.adapters.mode === 'mock') {
    // 1순위·대체 두 종류를 등록해 Fallback 경로를 로컬에서 재현할 수 있게 한다.
    registry.register(new MockImageBackend(storage, { name: 'mock-image-a', unitCostKrw: 120 }), 10);
    registry.register(new MockImageBackend(storage, { name: 'mock-image-b', unitCostKrw: 180 }), 20);
    registry.register(new MockVideoBackend(storage, { name: 'mock-video-a', unitCostKrw: 900 }), 10);
    registry.register(new MockVoiceBackend(storage), 10);
    registry.register(new MockMusicBackend(storage), 10);
    registry.register(new MockEmbeddingBackend(storage), 10);
    log.info('mock backends registered', { mode: 'mock' });
    return registry;
  }

  // ADAPTERS=http — 벤더가 확정되면 baseUrl/apiKeyEnv 를 채운다 (부록 B #3, #4).
  registry.register(new HttpGenerationBackend({
    name: 'image-a', capability: 'image', unitCostKrw: 120,
    baseUrl: process.env.ADAPTER_IMAGE_A_URL ?? '', apiKeyEnv: 'ADAPTER_IMAGE_A_KEY',
  }, storage), 10);
  registry.register(new HttpGenerationBackend({
    name: 'image-b', capability: 'image', unitCostKrw: 180,
    baseUrl: process.env.ADAPTER_IMAGE_B_URL ?? '', apiKeyEnv: 'ADAPTER_IMAGE_B_KEY',
  }, storage), 20);
  registry.register(new HttpGenerationBackend({
    name: 'video-a', capability: 'video', unitCostKrw: 900,
    baseUrl: process.env.ADAPTER_VIDEO_A_URL ?? '', apiKeyEnv: 'ADAPTER_VIDEO_A_KEY',
    polling: { intervalMs: 5000, maxWaitMs: 900_000 },
  }, storage), 10);
  registry.register(new HttpGenerationBackend({
    name: 'embedding', capability: 'embedding', unitCostKrw: 5,
    baseUrl: process.env.ADAPTER_EMBED_URL ?? '', apiKeyEnv: 'ADAPTER_EMBED_KEY',
  }, storage), 10);
  log.info('http backends registered', { mode: 'http' });
  return registry;
}
