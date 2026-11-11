import {describe,expect,it} from 'vitest';
import {clearCache,formatCachedAt,readCache,writeCache} from './offline';
import {emptyDatabase} from './remote/mapping';

function memoryStorage():Storage{
 const map=new Map<string,string>();
 return {get length(){return map.size},clear:()=>map.clear(),getItem:k=>map.get(k)??null,
  key:i=>[...map.keys()][i]??null,removeItem:k=>{map.delete(k)},setItem:(k,v)=>{map.set(k,String(v))}} as Storage;
}

describe('离线快照缓存',()=>{
 it('写入后能按同一账号读回',()=>{
  const storage=memoryStorage(),db={...emptyDatabase(),coach:{id:'u1',name:'甲',email:'a@tempo.test',created_at:'2026-11-01T00:00:00Z'}};
  writeCache(db,'u1',storage,1_700_000_000_000);
  const cached=readCache('u1',storage);
  expect(cached?.database.coach.name).toBe('甲');
  expect(cached?.savedAt).toBe(1_700_000_000_000);
 });

 it('换账号读不到上一个人的缓存',()=>{
  const storage=memoryStorage();
  writeCache(emptyDatabase(),'u1',storage);
  expect(readCache('u2',storage)).toBeNull();
  expect(readCache('',storage)).toBeNull();
 });

 it('损坏或结构不完整的缓存被丢弃',()=>{
  const storage=memoryStorage();
  storage.setItem('tempo.cache.v1','{坏掉的 JSON');
  expect(readCache('u1',storage)).toBeNull();
  storage.setItem('tempo.cache.v1',JSON.stringify({userId:'u1',savedAt:1,database:{coach:{id:'u1'}}}));
  expect(readCache('u1',storage)).toBeNull();
 });

 it('清除后不再命中',()=>{
  const storage=memoryStorage();
  writeCache(emptyDatabase(),'u1',storage);
  clearCache(storage);
  expect(readCache('u1',storage)).toBeNull();
 });

 it('缓存时间当天只显示时分，跨天带日期',()=>{
  const at=new Date(2026,10,11,22,8).getTime();
  expect(formatCachedAt(at,new Date(2026,10,11,23,30))).toBe('22:08');
  expect(formatCachedAt(at,new Date(2026,10,12,9,0))).toBe('11月11日 22:08');
 });
});
