import type {Database, TrainingReview} from '../types';
import {dateKey,shift} from '../composables/date';
import {trendPerMonth} from './vendor/ischysTrend';

export type ReviewInput = Pick<TrainingReview,'rating'|'effort'|'actual_minutes'|'notes'>;
export function saveReview(data:Database,bookingId:string,input:ReviewInput):Database {
  const booking=data.bookings.find(b=>b.id===bookingId&&b.coach_id===data.coach.id);
  if(!booking||booking.status!=='completed')throw Error('只能评价已完成的课程');
  if(!Number.isInteger(input.rating)||input.rating<1||input.rating>5)throw Error('请选择 1–5 分的训练表现');
  if(input.effort!==null&&(!Number.isInteger(input.effort)||input.effort<1||input.effort>10))throw Error('用力程度应为 1–10，未询问学员时请留空');
  if(!Number.isInteger(input.actual_minutes)||input.actual_minutes<1||input.actual_minutes>600)throw Error('实际训练时长应为 1–600 分钟');
  if(input.notes.length>1000)throw Error('训练记录最多 1000 字');
  const old=data.reviews.find(r=>r.booking_id===bookingId),now=new Date().toISOString();
  const review:TrainingReview={...input,notes:input.notes.trim(),id:old?.id??crypto.randomUUID(),booking_id:bookingId,coach_id:data.coach.id,created_at:old?.created_at??now,updated_at:now};
  return {...data,reviews:[...data.reviews.filter(r=>r.booking_id!==bookingId),review]};
}

export function trainingStats(data:Database,studentId:string|undefined,days:number,now=new Date()) {
  const today=dateKey(now),since=days?shift(today,1-days):'';
  const completed=data.bookings.filter(b=>b.coach_id===data.coach.id&&b.status==='completed'&&(!studentId||b.student_id===studentId)&&dateKey(new Date(b.start_at))>=since&&Date.parse(b.start_at)<=now.getTime());
  const rows=completed.map(booking=>({booking,review:data.reviews.find(r=>r.booking_id===booking.id&&r.coach_id===data.coach.id)})).sort((a,b)=>a.booking.start_at.localeCompare(b.booking.start_at));
  const rated=rows.filter((row):row is typeof row & {review:TrainingReview}=>!!row.review);
  const efforts=rated.flatMap(r=>r.review.effort===null?[]:[r.review.effort]);
  const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  return {rows,rated,completed:rows.length,unrated:rows.length-rated.length,average:mean(rated.map(r=>r.review.rating)),effort:mean(efforts),effortCount:efforts.length,minutes:rated.reduce((sum,r)=>sum+r.review.actual_minutes,0),trend:studentId?trendPerMonth(rated.map(r=>({t:Date.parse(r.booking.start_at),value:r.review.rating}))):null};
}
