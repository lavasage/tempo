import {useSync} from '../stores/sync';
import {useTempo} from '../stores/tempo';
import {useAuth} from '../stores/auth';
import {readCache,writeCache} from '../services/offline';

export type BootSource = 'remote' | 'cache';

/**
 * 登录后进入应用前的唯一入口：拉快照 → 替换内存数据 → 补默认课程类型 → 写离线缓存
 * → 接回上次未提交的写操作。
 * 网络失败但有本账号缓存时，用缓存启动并标记缓存时间；两者都没有才抛错。
 */
export async function bootRemote():Promise<BootSource>{
 const tempo=useTempo(),sync=useSync(),auth=useAuth();
 try{
  const snapshot=await sync.pull();
  if(!snapshot)throw Error('未能读取账号数据，请稍后重试');
  tempo.replaceData(snapshot);
  if(!snapshot.types.length)tempo.ensureDefaultTypes();
  writeCache(tempo.data,auth.userId);
  // 上次没推完的操作先补发；成功后重取一次快照，避免界面停在被覆盖前的旧状态。
  const replayed=await sync.restore().catch(()=>false);
  if(replayed&&sync.pending===0&&!sync.error){
   const fresh=await sync.pull().catch(()=>null);
   if(fresh){tempo.replaceData(fresh);writeCache(tempo.data,auth.userId)}
  }
  return 'remote';
 }catch(error){
  const cached=readCache(auth.userId);
  if(!cached)throw error;
  tempo.replaceData(cached.database,cached.savedAt);
  return 'cache';
 }
}
