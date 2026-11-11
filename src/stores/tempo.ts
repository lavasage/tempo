import {defineStore} from 'pinia';
import {computed,ref} from 'vue';
import {createMemoryRepository} from '../repositories/local';
import {repository} from '../repositories/local';
import {seed} from '../mock/seed';
import {saveBookingRecord,setBookingStatus} from '../services/booking';
import {saveReview,type ReviewInput} from '../services/reviews';
import {validateAvailability} from '../services/availability';
import {createStudent,updateStudent,type StudentInput} from '../services/students';
import {remoteConfig} from '../services/remote/config';
import {emptyDatabase} from '../services/remote/mapping';
import {useSync,type SyncOp} from './sync';
import {pwa} from '../services/pwa';
import type {Booking,Status,Database,AvailabilitySettings,CourseType} from '../types';

/** 离线写入被拒：视图统一用 String(e) 展示，重写 toString 去掉 “Error:” 前缀。 */
class OfflineWriteError extends Error{override toString(){return this.message}}

const DEFAULT_TYPES: Omit<CourseType,'id'>[]=[{name:'力量训练',default_duration:60,color:'#ff7052'},{name:'功能训练',default_duration:60,color:'#4263eb'},{name:'普拉提',default_duration:60,color:'#0e9f8e'}];

export const useTempo=defineStore('tempo',()=>{
 const remote=remoteConfig()!==null;
 const repo=remote?createMemoryRepository(emptyDatabase()):repository;
 const error=ref(''),notice=ref(''),blocked=ref(false);
 /** 远端模式必须等快照拉取完成才渲染业务视图，避免闪出空壳或上一位教练的缓存。 */
 const hydrated=ref(!remote);
 /** 非 0 表示当前数据来自离线缓存，值为缓存时间戳。 */
 const cachedAt=ref(0);
 let initial:Database;
 try{initial=repo.load()}catch{initial=remote?emptyDatabase():seed();blocked.value=true;error.value='无法读取或保存本地数据。原数据未覆盖，请先刷新重试；重置将清除原数据。'}
 const data=ref(initial);
 const coachName=computed(()=>data.value.coach.name);

 function record(op:SyncOp){if(!remote)return;try{useSync().record(op)}catch{/* 同步层不可用不影响本地保存 */}}
 function commit(next:Database){if(blocked.value)throw Error('数据异常，无法保存，请刷新重试');repo.save(next);data.value=next}
 /** 远端模式下离线只读：同步队列在内存里，刷新会丢，索性拦住写入。 */
 function assertWritable(){if(remote&&!pwa.online)throw new OfflineWriteError('当前离线，修改需要联网后再试')}

 return {data,error,notice,blocked,hydrated,cachedAt,remote,coachName,
  addStudent(input:StudentInput,id:string){assertWritable();const next=createStudent(data.value,input,id);commit(next);notice.value='学员已添加';record({kind:'student.save',student:next.students.find(s=>s.id===id)!})},
  editStudent(id:string,input:StudentInput){assertWritable();const next=updateStudent(data.value,id,input);commit(next);notice.value='学员已保存';record({kind:'student.save',student:next.students.find(s=>s.id===id)!})},
  saveAvailability(settings:AvailabilitySettings){assertWritable();validateAvailability(settings);const next={...data.value,availability:JSON.parse(JSON.stringify(settings)) as AvailabilitySettings};commit(next);record({kind:'availability.save',settings:next.availability})},
  save(b:Booking){assertWritable();const exists=data.value.bookings.some(x=>x.id===b.id);const next=saveBookingRecord(data.value,b);commit(next);const saved=next.bookings.find(x=>x.id===b.id)!;record(exists?{kind:'booking.update',booking:saved}:{kind:'booking.create',booking:saved})},
  status(id:string,status:Status){assertWritable();const next=setBookingStatus(data.value,id,status);commit(next);record({kind:'booking.status',id,status})},
  review(id:string,input:ReviewInput){assertWritable();const next=saveReview(data.value,id,input);commit(next);record({kind:'review.save',review:next.reviews.find(r=>r.booking_id===id)!})},
  /** 登录后一次性替换为服务端快照；cached 非 0 表示来自离线缓存。 */
  replaceData(next:Database,cached=0){repo.save(next);data.value=next;hydrated.value=true;blocked.value=false;error.value='';cachedAt.value=cached},
  /** 新账号还没有课程类型时补上默认三项，并按同一事务口径逐条写入远端。 */
  ensureDefaultTypes(){if(data.value.types.length)return;const types=DEFAULT_TYPES.map(t=>({...t,id:crypto.randomUUID()}));commit({...data.value,types});for(const t of types)record({kind:'type.save',type:t,coachId:data.value.coach.id})},
  reset(){if(remote){data.value=emptyDatabase();hydrated.value=false;cachedAt.value=0;error.value='';notice.value='';return}const next=repo.reset();data.value=next;blocked.value=false;error.value='';notice.value=''}
 };
});
