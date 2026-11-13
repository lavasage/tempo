import type {Booking,Database,TrainingReview} from '../types';
import {dateKey,shift} from '../composables/date';
import {trendPerMonth} from './vendor/ischysTrend';

export type ReviewInput = Pick<TrainingReview,'rating'|'effort'|'actual_minutes'|'notes'>;
export interface TeachingRow {booking:Booking;review:TrainingReview|null}

/** 训练记录存在（哪怕没评分）与评分存在是两件事；页面与测试共用这一组判定。 */
export const hasLog = (review:TrainingReview|null|undefined):review is TrainingReview => !!review;
export const hasRating = (review:TrainingReview|null|undefined):review is TrainingReview&{rating:number} => !!review&&review.rating!==null;

export function saveReview(data:Database,bookingId:string,input:ReviewInput):Database {
  const booking=data.bookings.find(b=>b.id===bookingId&&b.coach_id===data.coach.id);
  if(!booking||booking.status!=='completed')throw Error('只能评价已完成的课程');
  const rating=input.rating,minutes=input.actual_minutes,notes=input.notes.trim();
  if(rating!==null&&(!Number.isInteger(rating)||rating<1||rating>5))throw Error('训练表现应为 1–5 分，暂不评分时请留空');
  if(input.effort!==null&&(!Number.isInteger(input.effort)||input.effort<1||input.effort>10))throw Error('用力程度应为 1–10，未询问学员时请留空');
  if(minutes!==null&&(!Number.isInteger(minutes)||minutes<1||minutes>600))throw Error('训练时长应为 1–600 分钟，未记录时请留空');
  if(input.notes.length>1000)throw Error('训练记录最多 1000 字');
  if(rating===null&&input.effort===null&&minutes===null&&!notes)throw Error('至少填写一项：评分、训练时长、用力程度或文字记录');
  const old=data.reviews.find(r=>r.booking_id===bookingId),now=new Date().toISOString();
  const review:TrainingReview={...input,rating,actual_minutes:minutes,notes,id:old?.id??crypto.randomUUID(),booking_id:bookingId,coach_id:data.coach.id,created_at:old?.created_at??now,updated_at:now};
  return {...data,reviews:[...data.reviews.filter(r=>r.booking_id!==bookingId),review]};
}

const minutesOf=(booking:Booking)=>Math.max(0,Math.round((Date.parse(booking.end_at)-Date.parse(booking.start_at))/60000));

/** 排课时长按预约起止时间汇总，不是实际授课时长，页面必须按这个名字展示。 */
export function durationText(minutes:number):string {
  if(!minutes)return '0 分钟';
  if(minutes<60)return `${minutes} 分钟`;
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return rest?`${hours} 小时 ${rest} 分`:`${hours} 小时`;
}

function completedRows(data:Database,studentId:string|undefined,days:number,now:Date) {
  const since=days?shift(dateKey(now),1-days):'';
  return data.bookings
    .filter(b=>b.coach_id===data.coach.id&&b.status==='completed'&&(!studentId||b.student_id===studentId)&&dateKey(new Date(b.start_at))>=since&&Date.parse(b.start_at)<=now.getTime())
    .map(booking=>({booking,review:data.reviews.find(r=>r.booking_id===booking.id&&r.coach_id===data.coach.id)??null}))
    .sort((a,b)=>a.booking.start_at.localeCompare(b.booking.start_at));
}

/** 我的页「授课记录」：只看已完成课程，按时间范围给统计、最近记录与待补反馈（同一个筛选口径）。 */
export function teachingRecords(data:Database,days:number,now=new Date()) {
  const all=completedRows(data,undefined,0,now),rows=completedRows(data,undefined,days,now).reverse();
  return {
    allCount:all.length,
    rows,
    latest:rows.slice(0,3),
    rest:rows.slice(3),
    /** 待补反馈 = 范围内已完成但没有评分，和列表同一时间范围。 */
    pending:rows.filter(row=>!hasRating(row.review)),
    scheduledMinutes:rows.reduce((sum,row)=>sum+minutesOf(row.booking),0),
    loggedMinutes:rows.reduce((sum,row)=>sum+(row.review?.actual_minutes??0),0),
    loggedCount:rows.filter(row=>hasLog(row.review)).length,
    ratedCount:rows.filter(row=>hasRating(row.review)).length,
    effortCount:rows.filter(row=>row.review?.effort!=null).length,
  };
}

/** 学员页「训练表现」：保留个人纵向数据，平均表现与平均用力都以该学员的评分为样本。 */
export function trainingStats(data:Database,studentId:string|undefined,days:number,now=new Date()) {
  const rows=completedRows(data,studentId,days,now);
  const rated=rows.filter((row):row is TeachingRow&{review:TrainingReview&{rating:number}}=>hasRating(row.review));
  const efforts=rows.flatMap(r=>r.review?.effort==null?[]:[r.review.effort]);
  const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  return {
    rows,
    rated,
    completed:rows.length,
    unrated:rows.length-rated.length,
    average:mean(rated.map(r=>r.review.rating)),
    effort:mean(efforts),
    effortCount:efforts.length,
    loggedCount:rows.filter(row=>hasLog(row.review)).length,
    minutes:rows.reduce((sum,row)=>sum+(row.review?.actual_minutes??0),0),
    trend:studentId?trendPerMonth(rated.map(r=>({t:Date.parse(r.booking.start_at),value:r.review.rating}))):null,
  };
}
