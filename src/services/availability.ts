import type {AvailabilitySettings,Database,WeeklyWindow} from '../types';

export interface TimeInterval {start:number;end:number}
const MINUTE=60_000;
const ALL_DAYS=[0,1,2,3,4,5,6];

export function defaultAvailability():AvailabilitySettings {
  const window=():WeeklyWindow=>({id:crypto.randomUUID(),days:[...ALL_DAYS],start:'08:00',end:'21:00'});
  return {business:[window()],work:[window()],breaks:[],buffer_minutes:0,blocked:[]};
}

function clock(value:unknown,allowMidnight=false):value is string {
  return typeof value==='string'&&(/^([01]\d|2[0-3]):[0-5]\d$/.test(value)||(allowMidnight&&value==='24:00'));
}

/** Validate persisted input too: TypeScript types do not validate localStorage. */
export function validateAvailability(settings:AvailabilitySettings):void {
  if(!settings||!Number.isInteger(settings.buffer_minutes)||settings.buffer_minutes<0||settings.buffer_minutes>180)throw Error('课程间隔应为 0–180 分钟');
  const ids=new Set<string>();
  for(const list of [settings.business,settings.work,settings.breaks]){
    if(!Array.isArray(list))throw Error('时间规则格式错误');
    for(const rule of list){
      if(!rule||typeof rule.id!=='string'||!rule.id||ids.has(rule.id))throw Error('时间规则标识无效或重复');
      ids.add(rule.id);
      if(!Array.isArray(rule.days)||!rule.days.length||rule.days.some(day=>!Number.isInteger(day)||day<0||day>6)||new Set(rule.days).size!==rule.days.length)throw Error('请选择有效的重复日期');
      if(!clock(rule.start)||!clock(rule.end,true)||rule.start===rule.end)throw Error('请选择有效的开始和结束时间');
    }
  }
  if(!Array.isArray(settings.blocked))throw Error('不可预约时段格式错误');
  for(const block of settings.blocked){
    if(!block||typeof block.id!=='string'||!block.id||ids.has(block.id))throw Error('不可预约时段标识无效或重复');
    ids.add(block.id);
    if(typeof block.start_at!=='string'||typeof block.end_at!=='string'||!Number.isFinite(Date.parse(block.start_at))||!Number.isFinite(Date.parse(block.end_at))||Date.parse(block.end_at)<=Date.parse(block.start_at))throw Error('请选择有效的不可预约时段');
    if(typeof block.label!=='string'||block.label.length>100)throw Error('不可预约时段名称最多 100 字');
  }
}

function localDay(day:string):Date|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
  const date=new Date(day+'T00:00:00');
  if(!Number.isFinite(date.getTime())||key(date)!==day)return null;
  return date;
}
function key(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function nextDate(date:Date,offset=1){const next=new Date(date);next.setDate(next.getDate()+offset);return next;}
function timeOnDate(date:Date,time:string){const [hour,minute]=time.split(':').map(Number);const result=new Date(date);result.setHours(hour!,minute!,0,0);return result.getTime();}
function overlaps(a:TimeInterval,b:TimeInterval){return a.start<b.end&&a.end>b.start;}

function merge(ranges:TimeInterval[]):TimeInterval[] {
  const merged:TimeInterval[]=[];
  for(const range of ranges.filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start)){
    const last=merged[merged.length-1];
    if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);
    else merged.push({...range});
  }
  return merged;
}
function intersect(left:TimeInterval[],right:TimeInterval[]):TimeInterval[]{
  return merge(left.flatMap(a=>right.filter(b=>overlaps(a,b)).map(b=>({start:Math.max(a.start,b.start),end:Math.min(a.end,b.end)}))));
}
function subtract(ranges:TimeInterval[],cuts:TimeInterval[]):TimeInterval[]{
  let output=ranges;
  for(const cut of merge(cuts))output=output.flatMap(range=>{
    if(!overlaps(range,cut))return [range];
    const pieces:TimeInterval[]=[];
    if(cut.start>range.start)pieces.push({start:range.start,end:cut.start});
    if(cut.end<range.end)pieces.push({start:cut.end,end:range.end});
    return pieces;
  });
  return output;
}

/** Weekly days refer to the START day, so a Monday 22–02 rule includes Tuesday 00–02. */
function recurring(rules:WeeklyWindow[],date:Date):TimeInterval[]{
  const anchors=[nextDate(date,-1),date];
  return merge(anchors.flatMap(anchor=>rules.filter(r=>r.days.includes(anchor.getDay())).map(rule=>{
    const endDate=rule.end<rule.start?nextDate(anchor):anchor;
    return {start:timeOnDate(anchor,rule.start),end:timeOnDate(endDate,rule.end)};
  })));
}

/** Clipped to a LOCAL calendar day (which can be 23 or 25 hours at DST). No bookings removed. */
export function dayWindows(settings:AvailabilitySettings,day:string):TimeInterval[]{
  const date=localDay(day);if(!date)return [];
  const bounds=[{start:date.getTime(),end:nextDate(date).getTime()}];
  const work=intersect(intersect(recurring(settings.business,date),recurring(settings.work,date)),bounds);
  return subtract(work,[...recurring(settings.breaks,date),...settings.blocked.map(b=>({start:Date.parse(b.start_at),end:Date.parse(b.end_at)}))]);
}

function covers(settings:AvailabilitySettings,range:TimeInterval):boolean {
  let cursor=range.start;
  let date=new Date(range.start);date.setHours(0,0,0,0);
  while(date.getTime()<range.end){
    for(const window of dayWindows(settings,key(date))){
      if(window.end<=cursor)continue;
      if(window.start>cursor)return false;
      cursor=window.end;
      if(cursor>=range.end)return true;
    }
    const tomorrow=nextDate(date);
    if(cursor<tomorrow.getTime())return false;
    date=tomorrow;
  }
  return cursor>=range.end;
}

/** One gap between lessons, NOT a buffer on both lessons summed together. */
export function availabilityError(data:Database,start_at:string,end_at:string,excludeId?:string):string {
  const range={start:Date.parse(start_at),end:Date.parse(end_at)};
  if(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.end<=range.start)return '请选择有效的开始时间和时长';
  const active=data.bookings.filter(b=>b.id!==excludeId&&b.coach_id===data.coach.id&&b.status!=='cancelled');
  if(active.some(b=>overlaps(range,{start:Date.parse(b.start_at),end:Date.parse(b.end_at)})))return '此时段与已有课程重叠，请选择其他时间';
  const buffer=data.availability.buffer_minutes*MINUTE;
  if(buffer&&active.some(b=>overlaps(range,{start:Date.parse(b.start_at)-buffer,end:Date.parse(b.end_at)+buffer})))return `课程之间需间隔 ${data.availability.buffer_minutes} 分钟`;
  if(data.availability.blocked.some(b=>overlaps(range,{start:Date.parse(b.start_at),end:Date.parse(b.end_at)})))return '此时段已设为不可预约';
  if(!covers(data.availability,range))return '此时段不在可预约时间内';
  return '';
}

/** Suggestions use half-hour LOCAL wall-clock starts, and real elapsed duration. */
export function availableSlots(data:Database,day:string,duration=60,excludeId?:string):string[]{
  const date=localDay(day);if(!date||!Number.isFinite(duration)||duration<=0)return [];
  const slots:string[]=[];
  for(let minute=0;minute<1440;minute+=30){
    const hour=Math.floor(minute/60),part=minute%60;
    const start=new Date(date);start.setHours(hour,part,0,0);
    // A spring-forward time that does not exist must not be shown as a duplicate 03:00.
    if(start.getHours()!==hour||start.getMinutes()!==part)continue;
    const end=new Date(start.getTime()+duration*MINUTE);
    if(!Number.isFinite(end.getTime()))continue;
    if(!availabilityError(data,start.toISOString(),end.toISOString(),excludeId))slots.push(`${String(hour).padStart(2,'0')}:${String(part).padStart(2,'0')}`);
  }
  return slots;
}
