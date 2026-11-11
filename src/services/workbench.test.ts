import {describe,it,expect} from 'vitest';
import {seed} from '../mock/seed';
import {workbench} from './workbench';
const now=new Date('2026-11-11T10:30:00');
describe('教练工作台',()=>{
 function fixture(){const d=seed(),b=d.bookings[0]!;d.bookings=[9,11,14,17].map((h,i)=>({...b,id:String(i),status:i===2?'pending' as const:'confirmed' as const,start_at:new Date(`2026-11-11T${String(h).padStart(2,'0')}:00:00`).toISOString(),end_at:new Date(`2026-11-11T${String(h+1).padStart(2,'0')}:00:00`).toISOString()}));return d}
 it('指标实时派生，下一节只选有效确认，过去课程待完成',()=>{const d=fixture(),s=workbench(d,now);expect(s).toMatchObject({todayCount:4,todayPending:1,weekCount:4,monthCompleted:0,ongoing:false});expect(s.next?.id).toBe('1');expect(s.items.map(i=>i.kind)).toEqual(['unfinished','soon','pending'])});
 it('进行中的优先于未来课程；下一节跨天仍显示',()=>{const d=fixture();expect(workbench(d,new Date('2026-11-11T11:30:00'))).toMatchObject({ongoing:true,next:{id:'1'}});d.bookings[3]!.start_at=new Date('2026-11-12T09:00:00').toISOString();d.bookings[3]!.end_at=new Date('2026-11-12T10:00:00').toISOString();expect(workbench(d,new Date('2026-11-11T20:00:00')).next?.id).toBe('3')});
 it('取消不计数/待办，完成更新本月，不自动完成历史',()=>{const d=fixture();d.bookings[0]!.status='completed';d.bookings[1]!.status='cancelled';const s=workbench(d,now);expect(s.todayCount).toBe(3);expect(s.monthCompleted).toBe(1);expect(s.items.some(i=>['0','1'].includes(i.booking.id))).toBe(false);expect(d.bookings[3]!.status).toBe('confirmed')});
 it('冲突异常独立显示且同一课程不会重复列待办',()=>{const d=fixture();d.availability.work=[];const s=workbench(d,now);expect(s.items.filter(i=>i.kind==='conflict')).toHaveLength(3);expect(new Set(s.items.map(i=>i.booking.id)).size).toBe(s.items.length)});
 it('自然周跨月，统计按本地课程开始日归属且隔离教练',()=>{const d=fixture(),b=d.bookings[0]!;d.bookings=[{...b,status:'completed',start_at:new Date('2026-11-30T23:00:00').toISOString(),end_at:new Date('2026-12-01T01:00:00').toISOString()},{...b,id:'other',coach_id:'other'}];expect(workbench(d,new Date('2026-12-01T00:30:00'))).toMatchObject({todayCount:0,weekCount:1,monthCompleted:0})});
 it('无数据时没有虚构下一节或待办',()=>{const d=fixture();d.bookings=[];expect(workbench(d,now)).toMatchObject({todayCount:0,next:null,items:[],monthCompleted:0})});
});
