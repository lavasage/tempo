import {defineStore} from 'pinia';
import {ref} from 'vue';
import {remoteConfig} from '../services/remote/config';
import {createApiClient} from '../services/remote/client';
import {createRemoteRepository,type RemoteRepository} from '../services/remote/repository';
import {useAuth} from './auth';
import type {AvailabilitySettings,Booking,CourseType,Database,Status,Student,TrainingReview} from '../types';

export type SyncOp =
  | {kind: 'student.save'; student: Student}
  | {kind: 'type.save'; type: CourseType; coachId: string}
  | {kind: 'booking.create'; booking: Booking}
  | {kind: 'booking.update'; booking: Booking}
  | {kind: 'booking.status'; id: string; status: Status}
  | {kind: 'review.save'; review: TrainingReview}
  | {kind: 'availability.save'; settings: AvailabilitySettings};

/**
 * 远端同步队列：本地先保存（界面即时），再按顺序推送。
 * 推送失败保留队列并停住，不丢操作；由界面上的「重试」再次触发。
 */
export const useSync=defineStore('sync',()=>{
 const auth=useAuth();
 const pending=ref(0),error=ref(''),lastOk=ref<number|null>(null);
 const queue:SyncOp[]=[];
 let running=false,repo:RemoteRepository|null=null;

 function repository():RemoteRepository|null{
  const cfg=remoteConfig();
  if(!cfg)return null;
  repo??=createRemoteRepository(createApiClient({config:cfg,token:auth.token}));
  return repo;
 }

 async function apply(op:SyncOp){
  const r=repository();
  if(!r)throw Error('未配置 Supabase');
  switch(op.kind){
   case 'student.save':return r.saveStudent(op.student);
   case 'type.save':return r.saveType(op.type,op.coachId);
   case 'booking.create':return r.createBooking(op.booking);
   case 'booking.update':return r.updateBooking(op.booking);
   case 'booking.status':return r.setStatus(op.id,op.status);
   case 'review.save':return r.saveReview(op.review);
   case 'availability.save':return r.saveAvailability(op.settings);
  }
 }

 async function drain(){
  if(running)return;
  running=true;
  try{
   while(queue.length){
    const op=queue[0]!;
    try{await apply(op);queue.shift();pending.value=queue.length;error.value='';lastOk.value=Date.now()}
    catch(e){error.value=e instanceof Error?e.message:'同步失败，请稍后重试';break}
   }
  }finally{running=false}
 }

 return {pending,error,lastOk,
  /** 登录后拉取本账号快照；本地模式返回 null。 */
  async pull():Promise<Database|null>{if(auth.mode!=='remote'||!auth.signedIn)return null;const r=repository();if(!r)return null;return r.load()},
  record(op:SyncOp){if(auth.mode!=='remote')return;queue.push(op);pending.value=queue.length;void drain()},
  async retry(){error.value='';await drain()},
  reset(){queue.length=0;pending.value=0;error.value='';lastOk.value=null;repo=null}
 };
});
