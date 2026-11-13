import {describe,it,expect,vi,afterEach} from 'vitest';
import {seed} from '../mock/seed';
import {saveReview,trainingStats,teachingRecords,durationText} from './reviews';
import {trendPerMonth} from './vendor/ischysTrend';
import {repository} from '../repositories/local';
import type {Database,Status} from '../types';
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
 it('允许只记录不评分，但不允许保存空记录',()=>{const d=fixture(),id=d.bookings[0]!.id;const logged=saveReview(d,id,{rating:null,effort:null,actual_minutes:50,notes:''});expect(logged.reviews[0]!.rating).toBe(null);expect(logged.reviews[0]!.actual_minutes).toBe(50);expect(()=>saveReview(d,id,{rating:null,effort:null,actual_minutes:null,notes:'  '})).toThrow();const notesOnly=saveReview(d,id,{rating:null,effort:null,actual_minutes:null,notes:'只记一句'});expect(notesOnly.reviews[0]!.notes).toBe('只记一句')});
});

describe('授课记录',()=>{
 const at=(day:string,hour:number,minutes=60)=>[`2026-${day}T${String(hour).padStart(2,'0')}:00:00+08:00`,`2026-${day}T${String(hour+Math.floor((minutes)/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}:00+08:00`];
 function records(){
  const d=seed(),base={notes:'',package_id:null,created_at:'',updated_at:''};
  const mk=(key:string,student:number,day:string,hour:number,status:Status,minutes=60)=>{const [start,end]=at(day,hour,minutes);return {...base,id:key,coach_id:d.coach.id,student_id:d.students[student]!.id,course_type_id:d.types[0]!.id,start_at:start!,end_at:end!,status}};
  const review=(bookingId:string,rating:number|null,effort:number|null,actual:number|null)=>({id:'r-'+bookingId,booking_id:bookingId,coach_id:d.coach.id,rating,effort,actual_minutes:actual,notes:'',created_at:'',updated_at:''});
  d.bookings=[mk('b1',0,'11-11',9,'completed'),mk('b2',1,'11-10',9,'completed'),mk('b3',2,'11-09',10,'completed',90),mk('b4',3,'11-02',9,'completed'),mk('b5',3,'11-08',9,'cancelled'),mk('b6',4,'11-08',15,'pending'),mk('b7',4,'12-01',9,'completed'),mk('b8',4,'09-01',9,'completed')];
  d.reviews=[review('b1',5,7,55),review('b2',null,null,50),review('b4',4,null,null)];
  return d;
 }
 const query=(days:number,data=records())=>teachingRecords(data,days,now);

 it('无已完成课程时给出零结构，不把它们当成分数',()=>{const d=records();d.bookings=[];d.reviews=[];const r=query(30,d);expect(r.allCount).toBe(0);expect(r.rows).toHaveLength(0);expect(r.latest).toHaveLength(0);expect(r.scheduledMinutes).toBe(0)});

 it('取消、未完成与未来课程不计入完成统计',()=>{const r=query(90);expect(r.rows.map(x=>x.booking.id)).toEqual(['b1','b2','b3','b4','b8']);expect(r.allCount).toBe(5)});

 it('时间范围切换后数量、待补反馈与列表同口径',()=>{const d30=query(30),d7=query(7),d90=query(90),all=query(0);
  expect(d30.rows.map(x=>x.booking.id)).toEqual(['b1','b2','b3','b4']);
  expect(d7.rows.map(x=>x.booking.id)).toEqual(['b1','b2','b3']);
  expect(d90.rows).toHaveLength(5);expect(all.rows).toHaveLength(5);
  expect(d30.pending.map(x=>x.booking.id)).toEqual(['b2','b3']);
  expect(d7.pending.map(x=>x.booking.id)).toEqual(['b2','b3']);
  expect(d90.pending.map(x=>x.booking.id)).toEqual(['b2','b3','b8']);
  expect(d90.pending.length).toBe(d90.rows.filter(x=>x.review?.rating==null).length);
 });

 it('排课时长按预约起止时间，已记录训练时长只累加有记录的时长',()=>{const r=query(30);expect(r.scheduledMinutes).toBe(60+60+90+60);expect(r.loggedMinutes).toBe(55+50);expect(r.loggedCount).toBe(3);expect(r.ratedCount).toBe(2);expect(r.effortCount).toBe(1)});

 it('最近三条与剩余记录不重叠',()=>{const r=query(90);expect(r.latest.map(x=>x.booking.id)).toEqual(['b1','b2','b3']);expect(r.rest.map(x=>x.booking.id)).toEqual(['b4','b8']);expect(r.latest.length+r.rest.length).toBe(r.rows.length)});

 it('范围外为空与完全没有数据可区分',()=>{const empty=teachingRecords(records(),7,new Date('2026-11-20T12:00:00+08:00'));expect(empty.allCount).toBe(5);expect(empty.rows).toHaveLength(0);expect(empty.scheduledMinutes).toBe(0)});

 it('时长文案按小时与分钟分档',()=>{expect(durationText(0)).toBe('0 分钟');expect(durationText(45)).toBe('45 分钟');expect(durationText(120)).toBe('2 小时');expect(durationText(150)).toBe('2 小时 30 分')});

 it('学员统计只取本人样本，未评分不参与均值',()=>{const d=records();const s=trainingStats(d,d.students[1]!.id,30,now);expect(s.completed).toBe(1);expect(s.rated).toHaveLength(0);expect(s.average).toBe(null);expect(s.minutes).toBe(50);expect(s.loggedCount).toBe(1)});
});
describe('Ischys 迁移趋势函数',()=>{
 it('样本不足或跨度不足不输出趋势',()=>{expect(trendPerMonth([])).toBe(null);expect(trendPerMonth([0,1,2,3].map(i=>({t:i*86400000,value:i})))).toBe(null)});
 it('按真实时间间隔计算斜率，允许乱序',()=>{const points=[0,7,14,21].map((day,i)=>({t:day*86400000,value:i+1}));expect(trendPerMonth(points.reverse())).toBeCloseTo(30/7)});
 it('稳定评分的趋势为零',()=>expect(trendPerMonth([0,7,14,21].map(day=>({t:day*86400000,value:4})))).toBe(0));
});
