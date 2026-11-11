import {describe,it,expect,vi,afterEach} from 'vitest';
import {seed} from '../mock/seed';
import {saveReview,trainingStats} from './reviews';
import {trendPerMonth} from './vendor/ischysTrend';
import {repository} from '../repositories/local';
const input={rating:4,effort:7,actual_minutes:50,notes:' 有进步 '};
function fixture(){const d=seed();d.bookings[0]!.status='completed';d.bookings[0]!.start_at='2026-11-10T01:00:00Z';return d}
const now=new Date('2026-11-11T12:00:00Z');
afterEach(()=>vi.unstubAllGlobals());
describe('课后反馈',()=>{
 it('只允许已完成课程，拒绝不存在和其他教练',()=>{const d=fixture();expect(()=>saveReview(d,d.bookings[1]!.id,input)).toThrow();expect(()=>saveReview(d,'missing',input)).toThrow();d.bookings[0]!.coach_id='other';expect(()=>saveReview(d,d.bookings[0]!.id,input)).toThrow()});
 it('验证分值、整数、时长和备注',()=>{const d=fixture();for(const patch of [{rating:0},{rating:6},{rating:3.5},{effort:0},{effort:11},{actual_minutes:0},{actual_minutes:601},{actual_minutes:NaN},{notes:'x'.repeat(1001)}])expect(()=>saveReview(d,d.bookings[0]!.id,{...input,...patch})).toThrow()});
 it('补评和修改保持唯一记录',()=>{const d=fixture(),id=d.bookings[0]!.id;const first=saveReview(d,id,input),second=saveReview(first,id,{...input,rating:5});expect(d.reviews).toHaveLength(0);expect(second.reviews).toHaveLength(1);expect(second.reviews[0]!.id).toBe(first.reviews[0]!.id);expect(second.reviews[0]!.rating).toBe(5);expect(second.reviews[0]!.notes).toBe('有进步')});
 it('未评分不计零分，未询问用力程度不计入均值',()=>{const d=fixture();d.bookings[1]!.status='completed';d.bookings[1]!.start_at='2026-11-09T01:00:00Z';const saved=saveReview(d,d.bookings[0]!.id,{...input,effort:null});const s=trainingStats(saved,undefined,30,now);expect(s.average).toBe(4);expect(s.completed).toBe(2);expect(s.unrated).toBe(1);expect(s.minutes).toBe(50);expect(s.effort).toBe(null)});
 it('按学员、日期和课程状态筛选，排除未来记录',()=>{const d=fixture();const saved=saveReview(d,d.bookings[0]!.id,input);expect(trainingStats(saved,d.students[1]!.id,30,now).completed).toBe(0);expect(trainingStats(saved,undefined,7,new Date('2026-12-11T12:00:00Z')).completed).toBe(0);expect(trainingStats(saved,undefined,0,new Date('2026-11-01T12:00:00Z')).completed).toBe(0);saved.bookings[0]!.status='cancelled';expect(trainingStats(saved,undefined,0,now).rated).toHaveLength(0)});
 it('空数据不产生 NaN',()=>{const d=fixture();d.bookings=[];const s=trainingStats(d,undefined,30,now);expect(s.average).toBe(null);expect(s.minutes).toBe(0);expect(s.trend).toBe(null)});
 it('兼容旧版数据且刷新保留反馈',()=>{let raw='';vi.stubGlobal('localStorage',{getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value}});const d=fixture();const {reviews,...legacy}=d;raw=JSON.stringify(legacy);expect(repository.load().reviews).toEqual([]);const saved=saveReview(repository.load(),d.bookings[0]!.id,input);repository.save(saved);expect(repository.load().reviews).toEqual(saved.reviews)});
});
describe('Ischys 迁移趋势函数',()=>{
 it('样本不足或跨度不足不输出趋势',()=>{expect(trendPerMonth([])).toBe(null);expect(trendPerMonth([0,1,2,3].map(i=>({t:i*86400000,value:i})))).toBe(null)});
 it('按真实时间间隔计算斜率，允许乱序',()=>{const points=[0,7,14,21].map((day,i)=>({t:day*86400000,value:i+1}));expect(trendPerMonth(points.reverse())).toBeCloseTo(30/7)});
 it('稳定评分的趋势为零',()=>expect(trendPerMonth([0,7,14,21].map(day=>({t:day*86400000,value:4})))).toBe(0));
});
