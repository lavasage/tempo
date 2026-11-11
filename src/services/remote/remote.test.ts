import {describe,it,expect,vi} from 'vitest';
import {remoteConfig} from './config';
import {createApiClient,RemoteError} from './client';
import {clockFromMinutes,minutesFromClock,decodeSnapshot,decodeAvailability,availabilityPayload} from './mapping';
import {signInRequest,signOutRequest,refreshRequest,signUpRequest,readSession,writeSession,toSession} from './session';
import type {SnapshotJson} from './mapping';

const cfg={url:'https://demo.supabase.co',key:'anon-key'};
const reply=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body}) as unknown as Response;

function snapshot(overrides:Partial<SnapshotJson>={}):SnapshotJson{
 return {
  coach:{id:'coach-1',name:'甲教练',email:'a@tempo.test',created_at:'2026-11-01T00:00:00Z'},
  students:[{id:'s1',coach_id:'coach-1',name:'林晓',phone:'13800000001',notes:'',preferences:['t1'],created_at:'2026-11-01T00:00:00Z'}],
  types:[{id:'t1',name:'力量训练',default_duration:60,color:'#e6eee5'}],
  bookings:[{id:'b1',coach_id:'coach-1',student_id:'s1',course_type_id:'t1',start_at:'2026-11-12T01:00:00Z',end_at:'2026-11-12T02:00:00Z',status:'confirmed',notes:'',created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'}],
  reviews:[],
  events:[],
  availability:{buffer_minutes:15,rules:[
   {id:'r1',kind:'business',days:[1,2,3,4,5],start_minute:480,end_minute:1260},
   {id:'r2',kind:'work',days:[1,2,3,4,5],start_minute:540,end_minute:1080},
   {id:'r3',kind:'break',days:[1,2,3,4,5],start_minute:720,end_minute:780},
   {id:'r4',kind:'work',days:[6],start_minute:1320,end_minute:120}
  ],blocked:[{id:'k1',start_at:'2026-11-12T04:00:00Z',end_at:'2026-11-12T05:00:00Z',label:'午休'}]},
  ...overrides
 };
}

describe('远端配置',()=>{
 it('缺 URL 或 key 时退回本地演示',()=>{
  expect(remoteConfig({})).toBeNull();
  expect(remoteConfig({VITE_SUPABASE_URL:'https://x.supabase.co'})).toBeNull();
  expect(remoteConfig({VITE_SUPABASE_URL:'https://x.supabase.co',VITE_SUPABASE_ANON_KEY:'k'})).toEqual({url:'https://x.supabase.co',key:'k'});
 });
 it('去掉尾部斜杠，拒绝非 http 地址',()=>{
  expect(remoteConfig({VITE_SUPABASE_URL:'https://x.supabase.co///',VITE_SUPABASE_ANON_KEY:'k'})?.url).toBe('https://x.supabase.co');
  expect(remoteConfig({VITE_SUPABASE_URL:'x.supabase.co',VITE_SUPABASE_ANON_KEY:'k'})).toBeNull();
 });
});

describe('快照映射',()=>{
 it('分钟与时钟互转，24:00 不外溢',()=>{
  expect(clockFromMinutes(480)).toBe('08:00');
  expect(clockFromMinutes(1440)).toBe('24:00');
  expect(minutesFromClock('24:00')).toBe(1440);
  expect(minutesFromClock('08:30')).toBe(510);
  expect(clockFromMinutes(minutesFromClock('22:15'))).toBe('22:15');
 });
 it('规则按种类还原为窗口，跨夜保留 24:00 与次日边界',()=>{
  const availability=decodeAvailability(snapshot().availability);
  expect(availability.buffer_minutes).toBe(15);
  expect(availability.business).toEqual([{id:'r1',days:[1,2,3,4,5],start:'08:00',end:'21:00'}]);
  expect(availability.breaks[0]).toMatchObject({start:'12:00',end:'13:00'});
  expect(availability.work.map(w=>`${w.start}-${w.end}`)).toEqual(['09:00-18:00','22:00-02:00']);
  expect(availability.blocked).toEqual([{id:'k1',start_at:'2026-11-12T04:00:00Z',end_at:'2026-11-12T05:00:00Z',label:'午休'}]);
 });
 it('未登录快照直接拒绝，避免渲染空壳',()=>{
  expect(()=>decodeSnapshot(snapshot({coach:null}))).toThrow('重新登录');
 });
 it('完整快照转成前端 Database',()=>{
  const db=decodeSnapshot(snapshot());
  expect(db.coach.id).toBe('coach-1');
  expect(db.students[0]!.preferences).toEqual(['t1']);
  expect(db.bookings[0]!.status).toBe('confirmed');
  expect(db.booking_events).toEqual([]);
 });
 it('可用性转 RPC 参数，小时窗变分钟',()=>{
  const payload=availabilityPayload(decodeSnapshot(snapshot()).availability);
  expect(payload.p_buffer).toBe(15);
  expect(payload.p_business).toEqual([{id:'r1',days:[1,2,3,4,5],start_minute:480,end_minute:1260}]);
  expect(payload.p_blocked[0]).toMatchObject({id:'k1',label:'午休'});
 });
});

describe('认证请求',()=>{
 it('登录带上 apikey 并换算过期时间',async()=>{
  const fetchImpl=vi.fn(async()=>reply({access_token:'at',refresh_token:'rt',expires_in:3600,user:{id:'u1',email:'a@tempo.test'}}));
  const session=await signInRequest(cfg,' a@tempo.test ','secret',fetchImpl as unknown as typeof fetch);
  expect(session).toMatchObject({access_token:'at',refresh_token:'rt',user:{id:'u1',email:'a@tempo.test'}});
  expect(session.expires_at).toBeGreaterThan(Date.now());
  const [url,init]=fetchImpl.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('https://demo.supabase.co/auth/v1/token?grant_type=password');
  expect((init.headers as Record<string,string>).apikey).toBe('anon-key');
  expect(JSON.parse(String(init.body))).toEqual({email:'a@tempo.test',password:'secret'});
 });
 it('登录失败抛出服务端信息',async()=>{
  const fetchImpl=vi.fn(async()=>reply({error_description:'Invalid login credentials'},400));
  await expect(signInRequest(cfg,'a@tempo.test','bad',fetchImpl as unknown as typeof fetch)).rejects.toThrow('Invalid login credentials');
 });
 it('注册需要确认邮箱时不返回会话',async()=>{
  const fetchImpl=vi.fn(async()=>reply({user:{id:'u1',email:'a@tempo.test'}}));
  await expect(signUpRequest(cfg,'a@tempo.test','secret','甲',fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
 });
 it('续期沿用原 user，退出即使失败也不抛错',async()=>{
  const session={access_token:'old',refresh_token:'r1',expires_at:0,user:{id:'u1',email:'a@tempo.test'}};
  const refresh=vi.fn(async()=>reply({access_token:'new',refresh_token:'r2',expires_in:3600,user:{id:'u1',email:'a@tempo.test'}}));
  await expect(refreshRequest(cfg,session,refresh as unknown as typeof fetch)).resolves.toMatchObject({access_token:'new',user:{id:'u1'}});
  const failing=vi.fn(async()=>{throw Error('offline')});
  await expect(signOutRequest(cfg,session,failing as unknown as typeof fetch)).resolves.toBeUndefined();
 });
 it('会话读写与损坏数据回退',()=>{
  const store=new Map<string,string>();
  const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v)},removeItem:(k:string)=>{store.delete(k)}} as unknown as Storage;
  writeSession(toSession({access_token:'a',refresh_token:'b',expires_in:10,user:{id:'u1',email:'e'}}),storage);
  expect(readSession(storage)?.user.id).toBe('u1');
  storage.setItem('tempo.session.v1','{broken');
  expect(readSession(storage)).toBeNull();
 });
});

describe('远端 API 客户端',()=>{
 it('RPC 带 Bearer 与 apikey',async()=>{
  const fetchImpl=vi.fn(async()=>reply({ok:true}));
  const client=createApiClient({config:cfg,token:()=>'at',fetchImpl:fetchImpl as unknown as typeof fetch});
  await expect(client.rpc('snapshot')).resolves.toEqual({ok:true});
  const [url,init]=fetchImpl.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('https://demo.supabase.co/rest/v1/rpc/snapshot');
  expect((init.headers as Record<string,string>).Authorization).toBe('Bearer at');
 });
 it('未登录直接拒绝，不发请求',async()=>{
  const fetchImpl=vi.fn();
  const client=createApiClient({config:cfg,token:()=>null,fetchImpl:fetchImpl as unknown as typeof fetch});
  await expect(client.rpc('snapshot')).rejects.toBeInstanceOf(RemoteError);
  expect(fetchImpl).not.toHaveBeenCalled();
 });
 it('唯一约束与过期会话给出中文提示',async()=>{
  const unique=createApiClient({config:cfg,token:()=>'at',fetchImpl:(async()=>reply({code:'23505',message:'duplicate key'},409)) as unknown as typeof fetch});
  await expect(unique.upsert('students',[{id:'s1'}],'id')).rejects.toThrow('记录已存在');
  const expired=createApiClient({config:cfg,token:()=>'at',fetchImpl:(async()=>reply({},401)) as unknown as typeof fetch});
  await expect(expired.rpc('snapshot')).rejects.toThrow('登录已失效');
 });
 it('upsert 使用合并策略与冲突列',async()=>{
  const fetchImpl=vi.fn(async()=>reply(null,201));
  const client=createApiClient({config:cfg,token:()=>'at',fetchImpl:fetchImpl as unknown as typeof fetch});
  await client.upsert('students',[{id:'s1'}],'id');
  const [url,init]=fetchImpl.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toBe('https://demo.supabase.co/rest/v1/students?on_conflict=id');
  expect((init.headers as Record<string,string>).Prefer).toContain('merge-duplicates');
 });
});
