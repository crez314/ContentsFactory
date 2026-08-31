import type { SceneSourceType } from './enums';

/** assets.attributes — §4.1 자산 속성 표준값 */
export interface AssetAttributes {
  angle?: string;
  lighting?: string;
  background?: string;
  outfit?: string;
  pose?: string;
  expression?: string;
  [k: string]: string | undefined;
}

/** orders.asset_filter */
export interface AssetFilter {
  include?: Record<string, string[]>;
  exclude?: Record<string, string[]>;
}

/** orders.spec */
export interface OrderSpec {
  aspect?: string;          // '9:16' | '1:1' | '16:9'
  durationSec?: number;
  resolution?: string;      // '1080x1920'
}

/** channels.spec */
export interface ChannelSpec {
  aspect?: string;
  maxDurationSec?: number;
  captionLimit?: number;
  maxHashtags?: number;
  maxFileSizeMb?: number;
  supportsPrivateUpload?: boolean;
}

/** orders.concept / design */
export interface OrderConcept { campaign?: string; mood?: string; story?: string; [k: string]: unknown }
export interface OrderDesign { tone?: string; palette?: string[]; template?: string; [k: string]: unknown }

/** §4.4 blueprints.scene_plan */
export interface ScenePlan {
  seq: number;
  durationMs: number;
  sourceType: SceneSourceType;
  sourceAssetId?: string;
  prompt?: string;
  subtitle?: string;
}

/** blueprints.layout / style */
export interface BlueprintLayout {
  aspect: string;
  resolution: string;
  safeArea?: { top: number; bottom: number };
  typography?: { headline?: string; caption?: string };
  backgroundTreatment?: string;
}
export interface BlueprintStyle {
  tone?: string;
  palette?: string[];
  template?: string;
  bgmMood?: string;
}

/** artists.identity_ref */
export interface IdentityRef {
  refKeys: string[];
  vectorDim?: number;
  updatedAt?: string;
}

/** qc_results.area_scores */
export interface QcAreaScores {
  quality: number;
  identity: number;
  brand: number;
  policy: number;
  copyright: number;
  aiRisk: number;
}

export interface QcViolation {
  area: keyof QcAreaScores;
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}
