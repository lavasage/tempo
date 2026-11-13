import type {Booking,Status,Database,BookingEvent} from '../types';
import {availabilityError} from './availability';
export const labels:Record<Status,string>={pending:'待确认',confirmed:'已确认',completed:'已完成',cancelled:'已取消'};
const transitions:Record<Status,Status[]>={pending:['confirmed','cancelled'],confirmed:['completed','cancelled'],completed:[],cancelled:[]};
export function overlaps(a:Booking,b:Booking){return a.id!==b.id&&a.coach_id===b.coach_id&&a.status!=='cancelled'&&b.status!=='cancelled'&&Date.parse(a.start_at)<Date.parse(b.end_at)&&Date.parse(b.start_at)<Date.parse(a.end_at)}
export function validateBooking(b:Booking,all:Booking[]){
 if(!Number.isFinite(Date.parse(b.start_at))||!Number.isFinite(Date.parse(b.end_at))||Date.parse(b.end_at)<=Date.parse(b.start_at))throw Error('请选择有效的开始时间和时长');
 if(!b.id||!b.coach_id||!b.student_id||!b.course_type_id)throw Error('请选择学员和课程类型');
 if(!Object.hasOwn(labels,b.status))throw Error('无效课程状态');
 if(b.notes.length>1000)throw Error('课程备注最多 1000 字');
 if(all.some(x=>overlaps(b,x)))throw Error('此时段与已有课程重叠，请选择其他时间');
}
export function changeStatus(b:Booking,status:Status,now=new Date()):Booking{
 if(!transitions[b.status]?.includes(status))throw Error('不允许此状态变更，请先确认预约；已结束课程不可恢复');
 if(status==='completed'&&(!Number.isFinite(Date.parse(b.start_at))||Date.parse(b.start_at)>now.getTime()))throw Error('课程尚未开始，不能标记完成');
 return {...b,status,updated_at:now.toISOString()};
}
export function saveBooking(b:Booking,all:Booking[]){
 const old=all.find(x=>x.id===b.id);
 if(old){
  if(['completed','cancelled'].includes(old.status))throw Error('已结束课程不可修改');
  if(old.status!==b.status||old.coach_id!==b.coach_id||old.created_at!==b.created_at)throw Error('不能通过编辑更改状态或课程归属');
 }else if(!['pending','confirmed'].includes(b.status))throw Error('新建课程必须为待确认或已确认');
 validateBooking(b,all);return [...all.filter(x=>x.id!==b.id),b];
}
export function validateReferences(data:Database,b:Booking){
 if(b.coach_id!==data.coach.id)throw Error('课程不属于当前教练');
 if(!data.students.some(s=>s.id===b.student_id&&s.coach_id===b.coach_id))throw Error('学员不存在或不属于当前教练');
 if(!data.types.some(t=>t.id===b.course_type_id))throw Error('课程类型不存在');
}
function event(data:Database,before:Booking|null,after:Booking,kind:BookingEvent['kind']):Database{
 return {...data,booking_events:[...data.booking_events,{id:crypto.randomUUID(),booking_id:after.id,coach_id:data.coach.id,kind,before:before?{...before}:null,after:{...after},created_at:new Date().toISOString()}]};
}
export function saveBookingRecord(data:Database,b:Booking){
 validateReferences(data,b);const old=data.bookings.find(x=>x.id===b.id)??null;
 const updated={...b,updated_at:new Date().toISOString()};
 const bookings=saveBooking(updated,data.bookings);
 const unavailable=availabilityError(data,updated.start_at,updated.end_at,old?.id);
 if(unavailable)throw Error(unavailable);
 return event({...data,bookings},old,updated,old?'edited':'created');
}
export function setBookingStatus(data:Database,id:string,status:Status){
 const old=data.bookings.find(b=>b.id===id);if(!old)throw Error('课程不存在');
 validateReferences(data,old);const updated=changeStatus(old,status);
 if(status==='confirmed'){
  const unavailable=availabilityError(data,updated.start_at,updated.end_at,updated.id);
  if(unavailable)throw Error(unavailable);
 }
 return event({...data,bookings:data.bookings.map(b=>b.id===id?updated:b)},old,updated,'status');
}
/** A booking belongs to every local day its half-open interval intersects. */
export function onDay(b:Booking,day:string){
 const start=new Date(day+'T00:00:00'),end=new Date(start);end.setDate(end.getDate()+1);
 return Date.parse(b.start_at)<end.getTime()&&Date.parse(b.end_at)>start.getTime();
}
