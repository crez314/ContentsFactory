/** §6.2 역할과 권한 */
export const ROLE_RANK = {
  VIEWER: 0,
  REVIEWER: 1,
  OPERATOR: 2,
  ADMIN: 3,
  SUPER_ROOT: 4,
} as const;

export type Role = keyof typeof ROLE_RANK;
export const ROLES = Object.keys(ROLE_RANK) as Role[];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export function hasMinRole(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * REVIEWER 와 OPERATOR 는 상하 관계가 아니다 (§6.2 주의).
 * 랭크 비교만으로는 OPERATOR 가 REVIEWER 권한을 상속받게 되므로,
 * 승인·반려·공개전환은 이 별도 검사를 통과해야 한다.
 */
export const REVIEW_ROLES: Role[] = ['REVIEWER', 'ADMIN', 'SUPER_ROOT'];
export function canReview(role: Role): boolean {
  return REVIEW_ROLES.includes(role);
}
