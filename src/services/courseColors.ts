import type {CourseType} from '../types';

/**
 * 课程类型识别色。
 * 规则：颜色只由「类型名称」决定，固定映射到 tokens.css 里的 `--type-*` 变量；
 * 不依据学员、日期、索引或随机数，保证同一类型在任何视图里颜色一致。
 * 未匹配到的自定义类型统一落到中性灰（其他课程），不生成新颜色。
 */
export type CourseTone = {
  key: 'strength' | 'functional' | 'pilates' | 'cardio' | 'recovery' | 'other';
  bg: string;
  ink: string;
};

const TONES: {key: CourseTone['key']; match: string[]; bg: string; ink: string}[] = [
  {key: 'strength', match: ['力量', '增肌', '硬拉', '深蹲'], bg: 'var(--type-strength-bg)', ink: 'var(--type-strength-ink)'},
  {key: 'functional', match: ['功能', '体能', '体态', '核心'], bg: 'var(--type-functional-bg)', ink: 'var(--type-functional-ink)'},
  {key: 'pilates', match: ['普拉提', '塑形', '瑜伽'], bg: 'var(--type-pilates-bg)', ink: 'var(--type-pilates-ink)'},
  {key: 'cardio', match: ['有氧', '心肺', '跑步', '骑行'], bg: 'var(--type-cardio-bg)', ink: 'var(--type-cardio-ink)'},
  {key: 'recovery', match: ['拉伸', '恢复', '放松', '康复'], bg: 'var(--type-recovery-bg)', ink: 'var(--type-recovery-ink)'}
];

const OTHER: CourseTone = {key: 'other', bg: 'var(--type-other-bg)', ink: 'var(--type-other-ink)'};

/** 取某个课程类型的浅底 + 深字；找不到类型时按「其他」处理。 */
export function toneOf(type: CourseType | undefined): CourseTone {
  const name = type?.name ?? '';
  const hit = TONES.find(t => t.match.some(word => name.includes(word)));
  return hit ? {key: hit.key, bg: hit.bg, ink: hit.ink} : OTHER;
}

/** 按类型 id 取色调，供列表/月历等只需要 id 的视图使用。 */
export function toneById(types: CourseType[], id: string): CourseTone {
  return toneOf(types.find(t => t.id === id));
}

/** 只需一个小面积着色点（图标、圆点）时，取同一套识别色的深色端。 */
export function accentOf(type: CourseType | undefined, _index = 0): string {
  return toneOf(type).ink;
}
