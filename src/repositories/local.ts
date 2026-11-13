import type {Database} from '../types';
import {seed} from '../mock/seed';
import {defaultAvailability,validateAvailability} from '../services/availability';
export interface Repository {load():Database;save(data:Database):void;reset():Database}
export function decode(raw:string):Database {
 const d:Database=JSON.parse(raw);
 if(!d||!d.coach?.id||!Array.isArray(d.bookings)||!Array.isArray(d.students)||!Array.isArray(d.types))throw Error('本地数据结构损坏');
 d.reviews??=[];d.booking_events??=[];
 /** 套餐是后加的字段：老数据没有这两项时按空数组读取，不触发迁移提示。 */
 d.packages??=[];d.lesson_tx??=[];
 for(const b of d.bookings)if(b.package_id===undefined)b.package_id=null;
 if(d.availability===undefined)d.availability=defaultAvailability();
 validateAvailability(d.availability);
 if(!Array.isArray(d.reviews)||!Array.isArray(d.booking_events)||!Array.isArray(d.packages)||!Array.isArray(d.lesson_tx))throw Error('反馈、历史或套餐数据损坏');
 for(const list of [d.students,d.types,d.bookings,d.reviews,d.booking_events,d.packages,d.lesson_tx]){
  if(list.some(x=>!x||typeof x.id!=='string')||new Set(list.map(x=>x.id)).size!==list.length)throw Error('本地记录标识损坏或重复');
 }
 for(const s of d.students)if(typeof s.name!=='string'||typeof s.phone!=='string'||!Array.isArray(s.preferences)||s.coach_id!==d.coach.id)throw Error('学员数据损坏');
 for(const t of d.types)if(typeof t.name!=='string'||!Number.isFinite(t.default_duration))throw Error('课程类型损坏');
 for(const b of d.bookings)if(b.coach_id!==d.coach.id||!d.students.some(s=>s.id===b.student_id)||!d.types.some(t=>t.id===b.course_type_id)||!['pending','confirmed','completed','cancelled'].includes(b.status)||typeof b.notes!=='string'||!Number.isFinite(Date.parse(b.start_at))||!Number.isFinite(Date.parse(b.end_at))||Date.parse(b.end_at)<=Date.parse(b.start_at))throw Error('课程记录损坏');
 for(const b of d.bookings)if(b.package_id!==null&&!d.packages.some(p=>p.id===b.package_id))throw Error('课程关联的套餐不存在');
 for(const p of d.packages)if(p.coach_id!==d.coach.id||!d.students.some(s=>s.id===p.student_id)||typeof p.name!=='string'||!Number.isInteger(p.total_sessions)||p.total_sessions<1||p.total_sessions>500||!Number.isInteger(p.initial_used)||p.initial_used<0||p.initial_used>p.total_sessions||typeof p.purchased_on!=='string'||(p.expires_on!==null&&typeof p.expires_on!=='string'))throw Error('套餐记录损坏');
 for(const t of d.lesson_tx)if(t.coach_id!==d.coach.id||!d.packages.some(p=>p.id===t.package_id)||!['purchase','consume','refund','adjust'].includes(t.kind)||!Number.isInteger(t.quantity)||t.quantity===0||(t.booking_id!==null&&!d.bookings.some(b=>b.id===t.booking_id)))throw Error('课时流水损坏');
 for(const r of d.reviews)if(!d.bookings.some(b=>b.id===r.booking_id)||r.coach_id!==d.coach.id||(r.rating!==null&&(!Number.isInteger(r.rating)||r.rating<1||r.rating>5))||(r.actual_minutes!==null&&(!Number.isInteger(r.actual_minutes)||r.actual_minutes<1||r.actual_minutes>600))||typeof r.notes!=='string'||(r.effort!==null&&(!Number.isInteger(r.effort)||r.effort<1||r.effort>10)))throw Error('反馈记录损坏');
 if(new Set(d.reviews.map(r=>r.booking_id)).size!==d.reviews.length)throw Error('反馈记录重复');
 return d;
}
/** Optimistic stale-tab detection, not a cross-device transaction mechanism. */
export function createLocalRepository():Repository {
 let expected:string|null=null,loaded=false;
 return {
  load(){const raw=localStorage.getItem('tempo.v1');if(raw===null){const data=seed(),serialized=JSON.stringify(data);localStorage.setItem('tempo.v1',serialized);expected=serialized;loaded=true;return data}const data=decode(raw);expected=raw;loaded=true;return data},
  save(data){if(!loaded)throw Error('数据尚未成功读取，请刷新后重试');if(localStorage.getItem('tempo.v1')!==expected)throw Error('其他页面已更新数据，请刷新后重试，当前修改尚未保存');const raw=JSON.stringify(data);localStorage.setItem('tempo.v1',raw);expected=raw},
  reset(){const data=seed(),raw=JSON.stringify(data);localStorage.setItem('tempo.v1',raw);expected=raw;loaded=true;return data}
 };
}
export const repository=createLocalRepository();

/** 远端模式下不落本地，避免上一个账号的数据残留在同一台设备。 */
export function createMemoryRepository(initial:Database):Repository {
 let data=initial,loaded=true;
 return {
  load(){loaded=true;return data},
  save(next){if(!loaded)throw Error('数据尚未成功读取，请刷新后重试');data=next},
  reset(){data={...data,students:[],types:[],bookings:[],reviews:[],booking_events:[],packages:[],lesson_tx:[]};return data}
 };
}
