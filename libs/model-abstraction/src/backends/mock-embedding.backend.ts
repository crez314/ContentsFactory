import { createHash } from 'crypto';
import { StorageService } from '@cf/storage';
import { config } from '@cf/common';
import type { EmbeddingBackend, GenRequest, GenResult } from '../contracts';
import { MockBackendBase } from './mock-base';

const DIM = 128;

/**
 * 로컬용 임베딩 어댑터.
 * 실제 모델 대신 파일 내용 해시에서 결정적 벡터를 만든다.
 *
 * 중요한 성질: 같은 아티스트의 기준 자산끼리는 높은 유사도가 나오도록
 * artistSalt 를 벡터의 지배적 성분으로 넣는다. 그래야 Identity 검증(§4.5)의
 * 임계값·재시도 로직을 실제 모델 없이도 의미 있게 테스트할 수 있다.
 */
export class MockEmbeddingBackend extends MockBackendBase implements EmbeddingBackend {
  readonly capability = 'embedding' as const;
  readonly dim = DIM;

  constructor(private readonly storage: StorageService, opts: { name?: string; unitCostKrw?: number } = {}) {
    super(opts.name ?? 'mock-embedding', opts.unitCostKrw ?? 5, opts);
  }

  async generate(_req: GenRequest): Promise<GenResult> {
    throw new Error('embedding backend does not produce files; use embed()');
  }

  async embed(storageKey: string): Promise<number[]> {
    await this.simulate();

    // 키 경로에서 아티스트 식별자를 뽑아 동일 인물 성분으로 쓴다.
    const artistSalt = /(?:assets|generated|contents)\/([^/]+)\//.exec(storageKey)?.[1] ?? 'unknown';
    let contentHash = 'na';
    try {
      contentHash = createHash('sha256').update(await this.storage.get(storageKey)).digest('hex');
    } catch {
      contentHash = createHash('sha256').update(storageKey).digest('hex');
    }

    const identity = vectorFrom(artistSalt);
    const variation = vectorFrom(contentHash);
    // identityBase(기본 0.90)만큼 동일 인물 성분이 지배한다.
    const w = config.adapters.mockIdentityBase;
    return normalize(identity.map((v, i) => w * v + (1 - w) * variation[i]));
  }
}

function vectorFrom(seed: string): number[] {
  const out: number[] = [];
  let block = 0;
  while (out.length < DIM) {
    const h = createHash('sha256').update(`${seed}#${block++}`).digest();
    for (let i = 0; i < h.length && out.length < DIM; i += 2) {
      out.push((h.readUInt16BE(i) / 65535) * 2 - 1);
    }
  }
  return normalize(out);
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
