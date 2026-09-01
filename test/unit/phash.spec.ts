import { hammingDistance, phashFromGrayscale, phashFromPng, syntheticImage } from '@cf/model-abstraction';

/**
 * §4.8.1 지각 해시.
 * 정품 표식의 최후 대조 수단이므로, 재인코딩·축소를 견디고 다른 이미지와는 갈라져야 한다.
 */
describe('§4.8.1 지각 해시 (pHash)', () => {
  const png = (seed: string, w = 320, h = 240) => syntheticImage({ width: w, height: h, seed });

  it('64bit(16 hex) 해시를 낸다', () => {
    const h = phashFromPng(png('a'));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('같은 이미지는 같은 해시', () => {
    expect(phashFromPng(png('same'))).toBe(phashFromPng(png('same')));
  });

  it('다른 이미지는 충분히 먼 해시', () => {
    const a = phashFromPng(png('one'))!;
    const b = phashFromPng(png('two'))!;
    expect(hammingDistance(a, b)).toBeGreaterThan(10);
  });

  it('크기를 줄여도 해시가 크게 흔들리지 않는다', () => {
    // 축소는 플랫폼 재인코딩에서 흔히 일어난다. 이때 대조가 깨지면 소명이 불가능하다.
    const full = phashFromPng(png('resize-me', 400, 300))!;
    const half = phashFromPng(png('resize-me', 200, 150))!;
    expect(hammingDistance(full, half)).toBeLessThanOrEqual(12);
  });

  it('해밍 거리는 대칭이고 자기 자신과는 0', () => {
    const a = phashFromPng(png('x'))!;
    const b = phashFromPng(png('y'))!;
    expect(hammingDistance(a, a)).toBe(0);
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });

  it('길이가 다른 해시는 비교하지 않는다', () => {
    expect(hammingDistance('abc', 'abcd')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('균일한 이미지도 해시를 낸다 (DC 성분 제외 확인)', () => {
    const flat = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => 128));
    expect(phashFromGrayscale(flat)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('PNG 가 아니면 null 을 돌려준다', () => {
    expect(phashFromPng(Buffer.from('not a png'))).toBeNull();
  });
});
