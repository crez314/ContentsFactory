import type { ValueTransformer } from 'typeorm';

/** pg 의 numeric 은 드라이버가 문자열로 돌려준다. 도메인 계층에서는 항상 number 로 다룬다. */
export const numericTransformer: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null): number | null => (v === null || v === undefined ? null : Number(v)),
};

export const bigintTransformer: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null): number | null => (v === null || v === undefined ? null : Number(v)),
};
