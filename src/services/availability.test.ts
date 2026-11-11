import {describe,it,expect,vi,afterEach} from 'vitest';
import {execFileSync} from 'node:child_process';
import process from 'node:process';
import {createPinia,setActivePinia} from 'pinia';
import {seed} from '../mock/seed';
import {decode,createLocalRepository} from '../repositories/local';
import {useTempo} from '../stores/tempo';
import type {AvailabilitySettings,Booking,WeeklyWindow} from '../types';
import {availableSlots,availabilityError,dayWindows,defaultAvailability,validateAvailability} from './availability';
import {saveBookingRecord,setBookingStatus} from './booking';

const MONDAY='2026-11-09';
const TUESDAY='2026-11-10';
const iso=(time:string,day=MONDAY)=>new Date(`${day}T${time}:00`).toISOString();
function rule(start:string,end:string,days=[1]):WeeklyWindow{return {id:crypto.randomUUID(),days,start,end};}
function fixture(){const data=seed();data.bookings=[];return data;}
function booking(data:ReturnType<typeof seed>,start='09:00',end='10:00',day=MONDAY):Booking {
  return {id:crypto.randomUUID(),coach_id:data.coach.id,student_id:data.students[0]!.id,course_type_id:data.types[0]!.id,start_at:iso(start,day),end_at:iso(end,day),status:'confirmed',notes:'',created_at:iso('00:00'),updated_at:iso('00:00')};
}
afterEach(()=>vi.unstubAllGlobals());

describe('统一时间可用性',()=>{
  it('默认营业/工作时间一致，半小时建议随时长变化',()=>{
    const data=fixture();
    expect(availableSlots(data,MONDAY,60)[0]).toBe('08:00');
    expect(availableSlots(data,MONDAY,60).at(-1)).toBe('20:00');
    expect(availableSlots(data,MONDAY,90).at(-1)).toBe('19:30');
    expect(availableSlots(data,MONDAY,30).at(-1)).toBe('20:30');
    expect(availabilityError(data,iso('07:59'),iso('09:00'))).toContain('可预约时间');
    expect(availabilityError(data,iso('20:00'),iso('21:00'))).toBe('');
  });
  it('取营业和个人工作交集，休息拆分窗口，多个相接规则合并',()=>{
    const data=fixture();
    data.availability.business=[rule('08:00','12:00'),rule('12:00','20:00')];
    data.availability.work=[rule('09:00','18:00')];
    data.availability.breaks=[rule('12:00','13:00')];
    expect(dayWindows(data.availability,MONDAY)).toEqual([{start:Date.parse(iso('09:00')),end:Date.parse(iso('12:00'))},{start:Date.parse(iso('13:00')),end:Date.parse(iso('18:00'))}]);
    expect(availabilityError(data,iso('11:30'),iso('13:30'))).toContain('可预约时间');
    expect(availabilityError(data,iso('11:00'),iso('12:00'))).toBe('');
    expect(availabilityError(data,iso('13:00'),iso('14:00'))).toBe('');
    expect(dayWindows(data.availability,TUESDAY)).toEqual([]);
  });
  it('空规则表示休息，不错误地回退默认',()=>{
    const data=fixture();data.availability.work=[];
    expect(availableSlots(data,MONDAY)).toEqual([]);
    expect(()=>validateAvailability(data.availability)).not.toThrow();
  });
  it('临时不可约按绝对时间跨天生效，首尾可相接',()=>{
    const data=fixture();
    data.availability.blocked=[{id:crypto.randomUUID(),start_at:iso('10:00'),end_at:iso('11:00',TUESDAY),label:'外出'}];
    expect(availabilityError(data,iso('09:00'),iso('10:00'))).toBe('');
    expect(availabilityError(data,iso('10:00'),iso('11:00'))).toContain('不可预约');
    expect(availabilityError(data,iso('10:30',TUESDAY),iso('11:30',TUESDAY))).toContain('不可预约');
    expect(availabilityError(data,iso('11:00',TUESDAY),iso('12:00',TUESDAY))).toBe('');
  });
  it('重复隔夜窗口以开始日为星期归属，第二天不必再勾选',()=>{
    const data=fixture();data.availability.business=[rule('22:00','02:00')];data.availability.work=[rule('23:00','01:30')];
    expect(availabilityError(data,iso('23:30'),iso('00:30',TUESDAY))).toBe('');
    expect(availableSlots(data,TUESDAY,60)).toEqual(['00:00','00:30']);
    expect(availabilityError(data,iso('01:00',TUESDAY),iso('02:00',TUESDAY))).toContain('可预约时间');
    data.availability.breaks=[rule('23:45','00:15')];
    expect(availabilityError(data,iso('23:30'),iso('00:30',TUESDAY))).toContain('可预约时间');
  });
  it('跨日窗口之间出现任何空隙均拒绝',()=>{
    const data=fixture();data.availability.business=[rule('22:00','24:00'),rule('00:30','02:00',[2])];data.availability.work=[rule('22:00','02:00')];
    expect(availabilityError(data,iso('23:30'),iso('01:00',TUESDAY))).toContain('可预约时间');
  });
  it('零缓冲允许相接，有缓冲时仅要求一个间隔且双向对称',()=>{
    const data=fixture();data.bookings=[booking(data,'10:00','11:00')];
    expect(availabilityError(data,iso('09:00'),iso('10:00'))).toBe('');
    expect(availabilityError(data,iso('11:00'),iso('12:00'))).toBe('');
    data.availability.buffer_minutes=15;
    expect(availabilityError(data,iso('09:00'),iso('10:00'))).toContain('15');
    expect(availabilityError(data,iso('11:14'),iso('12:00'))).toContain('15');
    expect(availabilityError(data,iso('09:00'),iso('09:45'))).toBe('');
    expect(availabilityError(data,iso('11:15'),iso('12:15'))).toBe('');
    expect(availabilityError(data,iso('11:00'),iso('12:00'),data.bookings[0]!.id)).toBe('');
  });
  it('取消释放课程及缓冲，完成继续占用，其他教练不影响',()=>{
    const data=fixture();const b=booking(data);data.bookings=[b];data.availability.buffer_minutes=30;
    b.status='cancelled';expect(availabilityError(data,iso('09:00'),iso('10:00'))).toBe('');
    b.status='completed';expect(availabilityError(data,iso('09:00'),iso('10:00'))).toContain('重叠');
    expect(availabilityError(data,iso('10:00'),iso('11:00'))).toContain('间隔');
    b.coach_id='other';expect(availabilityError(data,iso('09:00'),iso('10:00'))).toBe('');
  });
  it('跨午夜相邻预约仍校验缓冲',()=>{
    const data=fixture();data.availability.business=[rule('00:00','24:00',[0,1,2,3,4,5,6])];data.availability.work=[rule('00:00','24:00',[0,1,2,3,4,5,6])];
    data.bookings=[booking(data,'23:00','23:45')];data.availability.buffer_minutes=30;
    expect(availabilityError(data,iso('00:00',TUESDAY),iso('01:00',TUESDAY))).toContain('间隔');
    expect(availabilityError(data,iso('00:15',TUESDAY),iso('01:15',TUESDAY))).toBe('');
  });
  it('无效日期/时长不会产生可点击建议',()=>{
    const data=fixture();expect(availableSlots(data,'2026-02-30')).toEqual([]);expect(dayWindows(data.availability,'')).toEqual([]);
    expect(availableSlots(data,MONDAY,0)).toEqual([]);expect(availableSlots(data,MONDAY,NaN)).toEqual([]);
    expect(availabilityError(data,'invalid',iso('10:00'))).not.toBe('');expect(availabilityError(data,iso('10:00'),iso('09:00'))).not.toBe('');
  });
});

describe('时间规则数据与服务集成',()=>{
  it('拒绝损坏规则/非法缓冲和标识重复',()=>{
    const settings=defaultAvailability();
    const corrupt:unknown[]=[null,{...settings,buffer_minutes:-1},{...settings,buffer_minutes:181},{...settings,buffer_minutes:1.5},{...settings,work:null},{...settings,work:[rule('09:00','09:00')]},{...settings,work:[rule('25:00','26:00')]},{...settings,work:[rule('08:00','09:00',[])]},{...settings,work:[rule('08:00','09:00',[7])]},{...settings,work:[rule('08:00','09:00',[1,1])]},{...settings,work:[settings.business[0]]},{...settings,blocked:[{id:'b',start_at:iso('10:00'),end_at:iso('09:00'),label:''}]}];
    for(const value of corrupt)expect(()=>validateAvailability(value as AvailabilitySettings)).toThrow();
  });
  it('旧版数据自动补默认规则、不修改课程；损坏的新字段拒绝恢复',()=>{
    const data=seed();const {availability,...old}=data;
    const restored=decode(JSON.stringify(old));expect(restored.bookings).toEqual(data.bookings);expect(restored.availability.work[0]!.start).toBe('08:00');
    expect(()=>decode(JSON.stringify({...data,availability:null}))).toThrow();
  });
  it('创建、改期和确认使用同一规则，调整设置不阻止完成/取消历史',()=>{
    let data=fixture();const b=booking(data,'07:00','08:00');expect(()=>saveBookingRecord(data,b)).toThrow('可预约时间');
    b.start_at=iso('09:00');b.end_at=iso('10:00');data=saveBookingRecord(data,b);
    data.availability.work=[rule('12:00','18:00')];
    expect(()=>saveBookingRecord(data,{...b,notes:'变更'})).toThrow('可预约时间');
    expect(setBookingStatus(data,b.id,'completed').bookings[0]!.status).toBe('completed');
    data.bookings[0]!.status='pending';
    expect(()=>setBookingStatus(data,b.id,'confirmed')).toThrow('可预约时间');
    expect(setBookingStatus(data,b.id,'cancelled').bookings[0]!.status).toBe('cancelled');
  });
  it('Store 保存规则持久化并隔离表单引用，失败不修改原数据',()=>{
    let raw:string|null=null;vi.stubGlobal('localStorage',{getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value}});
    setActivePinia(createPinia());const store=useTempo();const settings=defaultAvailability();settings.buffer_minutes=15;
    store.saveAvailability(settings);settings.buffer_minutes=45;
    expect(store.data.availability.buffer_minutes).toBe(15);expect(createLocalRepository().load().availability.buffer_minutes).toBe(15);
    expect(()=>store.saveAvailability({...settings,buffer_minutes:-1})).toThrow();expect(store.data.availability.buffer_minutes).toBe(15);
  });
});

describe('DST 本地日边界',()=>{
  it('纽约春季23小时/秋季25小时，跳过不存在的建议时间',()=>{
    const script=`import {dayWindows,availableSlots,defaultAvailability} from './src/services/availability.ts';
      const a=defaultAvailability();a.business[0].start='00:00';a.business[0].end='24:00';a.work[0].start='00:00';a.work[0].end='24:00';
      const data={availability:a,bookings:[],coach:{id:'coach'}};
      const spring=dayWindows(a,'2026-03-08')[0],fall=dayWindows(a,'2026-11-01')[0];
      console.log(JSON.stringify({spring:(spring.end-spring.start)/3600000,fall:(fall.end-fall.start)/3600000,slots:availableSlots(data,'2026-03-08',30)}));`;
    const output=execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,TZ:'America/New_York'},encoding:'utf8'});
    const result: {spring:number;fall:number;slots:string[]}=JSON.parse(output);
    expect(result.spring).toBe(23);expect(result.fall).toBe(25);expect(result.slots).not.toContain('02:00');expect(result.slots).not.toContain('02:30');expect(result.slots.filter(t=>t==='03:00')).toHaveLength(1);
  });
});
