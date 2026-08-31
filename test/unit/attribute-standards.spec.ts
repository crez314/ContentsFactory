import { ATTRIBUTE_NAMES, ATTRIBUTE_STANDARDS, validateAttributes } from '@cf/domain';

describe('§4.1 자산 속성 표준값', () => {
  it('명세의 6개 속성을 모두 갖는다', () => {
    expect(ATTRIBUTE_NAMES.sort()).toEqual(
      ['angle', 'background', 'expression', 'lighting', 'outfit', 'pose'],
    );
  });

  it('표준값에 있는 조합은 통과한다', () => {
    expect(validateAttributes({ angle: 'front', outfit: 'casual' })).toEqual([]);
  });

  it('표준값에 없는 값은 거부한다 — 자유 입력이 들어오면 매칭이 불가능해진다', () => {
    const issues = validateAttributes({ angle: 'diagonal' });
    expect(issues).toEqual([{ attribute: 'angle', value: 'diagonal', reason: 'UNKNOWN_VALUE' }]);
  });

  it('정의되지 않은 속성명도 거부한다', () => {
    const issues = validateAttributes({ hairstyle: 'long' });
    expect(issues[0].reason).toBe('UNKNOWN_ATTRIBUTE');
  });

  it('빈 값은 검사에서 제외한다', () => {
    expect(validateAttributes({ angle: '', outfit: undefined as unknown as string })).toEqual([]);
  });

  it('마스터에서 주입한 허용 목록을 쓸 수 있다', () => {
    expect(validateAttributes({ angle: 'diagonal' }, { angle: ['diagonal'] })).toEqual([]);
  });

  it('명세 표의 값이 그대로 들어 있다', () => {
    expect(ATTRIBUTE_STANDARDS.angle).toContain('side_left');
    expect(ATTRIBUTE_STANDARDS.background).toContain('studio_white');
    expect(ATTRIBUTE_STANDARDS.expression).toContain('playful');
  });
});
