import type {Booking,Database} from '../types';
import {dateKey,shift} from '../composables/date';
import {weekDays} from './calendar';
import {availabilityError} from './availability';

export interface WorkItem {booking:Booking;kind:'conflict'|'pending'|'unfinished'|'soon';reason:string}
export function workbench(data:Database,now=new Date()){
  const timestamp=now.getTime(),today=dateKey(now),weekStart=weekDays(today)[0]!,weekEnd=shift(weekStart,7);
  const bookings=data.bookings.filter(b=>b.coach_id===data.coach.id);
  const active=bookings.filter(b=>b.status!=='cancelled');
  const dayOf=(b:Booking)=>dateKey(new Date(b.start_at));
  const todayCourses=active.filter(b=>dayOf(b)===today);
  const confirmed=bookings.filter(b=>b.status==='confirmed'&&Date.parse(b.end_at)>timestamp).sort((a,b)=>Date.parse(a.start_at)-Date.parse(b.start_at));
  const next=confirmed[0]??null;
  const items:WorkItem[]=[];
  for(const b of bookings){
    if(b.status!=='pending'&&b.status!=='confirmed')continue;
    const start=Date.parse(b.start_at),end=Date.parse(b.end_at);
    const conflict=end>timestamp?availabilityError(data,b.start_at,b.end_at,b.id):'';
    if(conflict)items.push({booking:b,kind:'conflict',reason:conflict});
    else if(b.status==='pending')items.push({booking:b,kind:'pending',reason:'待确认'});
    else if(end<=timestamp)items.push({booking:b,kind:'unfinished',reason:'待记录完成'});
    else if(start<=timestamp+2*60*60*1000)items.push({booking:b,kind:'soon',reason:start<=timestamp?'进行中':'即将开始'});
  }
  items.sort((a,b)=>Date.parse(a.booking.start_at)-Date.parse(b.booking.start_at));
  return {today,todayCount:todayCourses.length,todayPending:todayCourses.filter(b=>b.status==='pending').length,
    weekCount:active.filter(b=>dayOf(b)>=weekStart&&dayOf(b)<weekEnd).length,
    monthCompleted:bookings.filter(b=>b.status==='completed'&&dayOf(b).slice(0,7)===today.slice(0,7)&&Date.parse(b.start_at)<=timestamp).length,
    next,ongoing:!!next&&Date.parse(next.start_at)<=timestamp,items};
}
