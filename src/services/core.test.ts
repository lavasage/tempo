import {describe,it,expect,vi,afterEach} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {seed} from '../mock/seed';
import {changeStatus,saveBookingRecord,setBookingStatus,onDay,overlaps} from './booking';
import {createLocalRepository,decode} from '../repositories/local';
import {useTempo} from '../stores/tempo';
import type {Status} from '../types';
const statuses:Status[]=['pending','confirmed','completed','cancelled'];
function storage(){let raw:string|null=null;const value={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v}};vi.stubGlobal('localStorage',value);return value}
afterEach(()=>vi.unstubAllGlobals());
describe('M1 状态与课程完整性',()=>{
 for(const from of statuses)for(const to of statuses)it(`${from} → ${to}`,()=>{const b={...seed().bookings[0]!,status:from};const allowed=(from==='pending'&&['confirmed','cancelled'].includes(to))||(from==='confirmed'&&['completed','cancelled'].includes(to));if(allowed)expect(changeStatus(b,to).status).toBe(to);else expect(()=>changeStatus(b,to)).toThrow()});
 it('终态字段及编辑入口状态不可更改',()=>{const d=seed(),b=d.bookings[0]!;for(const state of ['completed','cancelled'] as const){b.status=state;expect(()=>saveBookingRecord(d,{...b,notes:'改写'})).toThrow()}b.status='confirmed';expect(()=>saveBookingRecord(d,{...b,status:'cancelled'})).toThrow()});
 it('拒绝无效关联',()=>{const d=seed(),b=d.bookings[0]!;for(const patch of [{student_id:'missing'},{course_type_id:'missing'},{coach_id:'other'}])expect(()=>saveBookingRecord(d,{...b,...patch})).toThrow();expect(()=>setBookingStatus(d,'missing','completed')).toThrow()});
 it('编辑后再校验冲突，取消记录保留并可追溯',()=>{const d=seed(),b=d.bookings[0]!,other=d.bookings[1]!;expect(()=>saveBookingRecord(d,{...b,start_at:other.start_at,end_at:other.end_at})).toThrow('重叠');const edited=saveBookingRecord(d,{...b,notes:'更新'});const cancelled=setBookingStatus(edited,b.id,'cancelled');expect(cancelled.bookings).toHaveLength(d.bookings.length);expect(cancelled.booking_events).toHaveLength(2);expect(cancelled.booking_events[0]!.before?.notes).toBe('');expect(cancelled.booking_events[1]!.after.status).toBe('cancelled');expect(d.booking_events).toHaveLength(0)});
 it('跨午夜占用两天且右边界不占次日',()=>{const b={...seed().bookings[0]!,start_at:new Date('2026-11-11T23:30:00').toISOString(),end_at:new Date('2026-11-12T00:30:00').toISOString()};expect(onDay(b,'2026-11-11')).toBe(true);expect(onDay(b,'2026-11-12')).toBe(true);b.end_at=new Date('2026-11-12T00:00:00').toISOString();expect(onDay(b,'2026-11-12')).toBe(false)});
 it('不同时区表达同一时刻仍冲突，已完成仍占时',()=>{const b={...seed().bookings[0]!,status:'completed' as const,start_at:'2026-11-11T23:30:00+08:00',end_at:'2026-11-12T00:30:00+08:00'};expect(overlaps(b,{...b,id:'other',start_at:'2026-11-11T15:45:00Z',end_at:'2026-11-11T16:45:00Z'})).toBe(true)});
});
describe('M1 本地恢复与Store集成',()=>{
 it('首次生成立即保存，刷新ID稳定',()=>{storage();const first=createLocalRepository().load();expect(createLocalRepository().load()).toEqual(first)});
 it('损坏数据读取失败不覆盖且不能写入',()=>{const s=storage();s.setItem('', '{broken');const r=createLocalRepository();expect(()=>r.load()).toThrow();expect(()=>r.save(seed())).toThrow();expect(s.getItem()).toBe('{broken')});
 it('旧版记录迁移不丢课程，深层无效关联拒绝',()=>{const d=seed();const {reviews,booking_events,...old}=d;expect(decode(JSON.stringify(old)).bookings).toEqual(d.bookings);d.bookings[0]!.student_id='missing';expect(()=>decode(JSON.stringify(d))).toThrow()});
 it('其他标签已更新时拒绝陈旧快照',()=>{storage();const a=createLocalRepository(),b=createLocalRepository();const da=a.load(),db=b.load();da.coach.name='新名字';a.save(da);expect(()=>b.save(db)).toThrow('其他页面');expect(createLocalRepository().load().coach.name).toBe('新名字')});
 it('写入失败不改变Store或事件，重试后持久化',()=>{const s=storage();setActivePinia(createPinia());const store=useTempo();const old=JSON.stringify(store.data);const original=s.setItem;s.setItem=()=>{throw Error('quota')};expect(()=>store.save({...store.data.bookings[0]!,notes:'new'})).toThrow();expect(JSON.stringify(store.data)).toBe(old);s.setItem=original;store.save({...store.data.bookings[0]!,notes:'new'});expect(createLocalRepository().load().booking_events).toHaveLength(1)});
 it('读取失败隐藏业务且显式重置可恢复',()=>{const s=storage();s.setItem('','bad');setActivePinia(createPinia());const store=useTempo();expect(store.blocked).toBe(true);expect(()=>store.status(store.data.bookings[0]!.id,'cancelled')).toThrow();expect(s.getItem()).toBe('bad');store.reset();expect(store.blocked).toBe(false)});
});
