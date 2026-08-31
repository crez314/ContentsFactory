/**
 * §4.1 자산 속성 표준값.
 * 마스터 테이블(master_attribute_values)이 운영 시점의 단일 출처이고,
 * 이 상수는 시드·검증 기본값이자 DB 미가용 시의 폴백이다.
 */
export const ATTRIBUTE_STANDARDS = {
  angle:      ['front', 'side_left', 'side_right', 'low', 'high', 'back'],
  lighting:   ['soft', 'hard', 'backlit', 'natural', 'neon'],
  background: ['studio_white', 'studio_color', 'outdoor_street', 'outdoor_nature', 'indoor_set', 'chroma'],
  outfit:     ['casual', 'formal', 'stage', 'sports', 'seasonal'],
  pose:       ['standing', 'sitting', 'walking', 'dancing', 'closeup'],
  expression: ['smile', 'neutral', 'serious', 'playful'],
} as const;

export type AttributeName = keyof typeof ATTRIBUTE_STANDARDS;
export const ATTRIBUTE_NAMES = Object.keys(ATTRIBUTE_STANDARDS) as AttributeName[];

export const ATTRIBUTE_LABELS_KO: Record<AttributeName, string> = {
  angle: '앵글',
  lighting: '조명',
  background: '배경',
  outfit: '의상',
  pose: '포즈',
  expression: '표정',
};

export interface AttributeValidationIssue {
  attribute: string;
  value: string;
  reason: 'UNKNOWN_ATTRIBUTE' | 'UNKNOWN_VALUE';
}

/** 자유 입력 유입을 막는다. 허용 목록은 마스터에서 주입할 수 있다. */
export function validateAttributes(
  attributes: Record<string, unknown>,
  allowed: Record<string, string[]> = ATTRIBUTE_STANDARDS as unknown as Record<string, string[]>,
): AttributeValidationIssue[] {
  const issues: AttributeValidationIssue[] = [];
  for (const [attr, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === '') continue;
    const values = allowed[attr];
    if (!values) {
      issues.push({ attribute: attr, value: String(value), reason: 'UNKNOWN_ATTRIBUTE' });
      continue;
    }
    if (!values.includes(String(value))) {
      issues.push({ attribute: attr, value: String(value), reason: 'UNKNOWN_VALUE' });
    }
  }
  return issues;
}
