import {describe,it,expect} from 'vitest';
import {weekDays,monthDays,moveMonth,validDay,bookingLanes} from './calendar';
import {seed} from '../mock/seed';
describe('日历边界与重叠布局',()=>{
 it('自然周从周一开始并跨年',()=>expect(weekDays('2027-01-01')).toEqual(['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']));
 it('月格完整覆盖闰日，跨年切月不溢出',()=>{expect(monthDays('2028-02-15')).toContain('2028-02-29');expect(monthDays('2028-02-15')).toHaveLength(42);expect(moveMonth('2026-12-31',1)).toBe('2027-01-01')});
 it('非法日期回退有效日期',()=>expect(validDay('2026-02-30')).not.toBe('2026-02-30'));
 it('重叠课程保留独立点击列',()=>{const b=seed().bookings[0]!;const rows=bookingLanes([b,{...b,id:'overlap'}]);expect(rows.map(r=>r.lane)).toEqual([0,1]);expect(rows.every(r=>r.total===2)).toBe(true)});
});
