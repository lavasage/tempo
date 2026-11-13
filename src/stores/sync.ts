import {defineStore} from 'pinia';
import {ref} from 'vue';
import {remoteConfig} from '../services/remote/config';
import {createApiClient} from '../services/remote/client';
import {createRemoteRepository,type RemoteRepository} from '../services/remote/repository';
import {browserStorage,createOutbox,outboxKey,type Outbox,type SyncOp} from '../services/outbox';
import {useAuth} from './auth';
import type {Database} from '../types';

export type {SyncOp};

/**
 * 远端同步队列：本地先保存（界面即时），队列落盘后再按顺序推送。
 * 推送失败保留队列并停住，刷新或重连后从上次的位置继续；每个操作都必须幂等。
 */
export const useSync=defineStore('sync',()=>{
 const auth=useAuth();
 const pending=ref(0),error=ref(''),lastOk=ref<number|null>(null),attempts=ref(0);
 let box:Outbox|null=null;
 let boxKey='',repo:RemoteRepository|null=null;

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
   case 'package.save':return r.savePackage(op.pkg);
   case 'lesson.revert':return r.revertLesson(op.bookingId,op.reason);
  }
 }

 /** 队列按账号分键：换账号不会把上一个账号的操作推上去。 */
 function outbox():Outbox{
  const key=outboxKey(auth.userId);
  if(box&&boxKey===key)return box;
  boxKey=key;
  box=createOutbox({
   key,
   storage:browserStorage(),
   apply,
   onChange:snapshot=>{
    pending.value=snapshot.ops.length;
    error.value=snapshot.error;
    lastOk.value=snapshot.lastOk;
    attempts.value=snapshot.ops[0]?.attempts??0;
   }
  });
  pending.value=box.snapshot().ops.length;
  return box;
 }

 return {pending,error,lastOk,attempts,
  /** 登录后拉取本账号快照；本地模式返回 null。 */
  async pull():Promise<Database|null>{if(auth.mode!=='remote'||!auth.signedIn)return null;const r=repository();if(!r)return null;return r.load()},
  record(op:SyncOp){if(auth.mode!=='remote')return;const b=outbox();b.push(op);void b.drain()},
  /** 刷新或重连后接回上次未提交的操作，并继续按顺序推送；返回是否真的推送过。 */
  async restore(){
   if(auth.mode!=='remote'||!auth.signedIn)return false;
   const b=outbox();b.restore();
   if(!b.snapshot().ops.length)return false;
   await b.drain();
   return true;
  },
  async retry(){await outbox().drain()},
  /** 退出登录：只断开当前账号的会话，未提交的操作留在本机，下次登录继续。 */
  detach(){box=null;boxKey='';repo=null;pending.value=0;error.value='';lastOk.value=null;attempts.value=0},
  /** 彻底丢弃本账号未提交的操作（仅在明确放弃时使用）。 */
  reset(){box?.clear();box=null;boxKey='';repo=null;pending.value=0;error.value='';lastOk.value=null;attempts.value=0}
 };
});
