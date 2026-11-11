import {beforeEach,describe,expect,it} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {useAuth} from './auth';

/** 没有 VITE_SUPABASE_* 时应完全走本地演示，不出现登录门槛。 */
describe('认证模式',()=>{
 beforeEach(()=>setActivePinia(createPinia()));
 it('未配置 Supabase 时为本地模式且视为已登录',async()=>{
  const auth=useAuth();
  expect(auth.mode).toBe('local');
  expect(auth.signedIn).toBe(true);
  expect(auth.ready).toBe(true);
  expect(auth.token()).toBeNull();
  await auth.init();
  expect(auth.ready).toBe(true);
  await auth.signIn('a@tempo.test','secret');
  expect(auth.signedIn).toBe(true);
  expect(auth.error).toBe('');
 });
});
