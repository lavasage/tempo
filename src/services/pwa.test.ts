import {beforeEach,describe,expect,it,vi} from 'vitest';
import {applyUpdate,detectStandalone,dismissInstall,initPwa,needsIosInstallHint,promptInstall,pwa} from './pwa';

/** 够用的假 window：只实现被用到的监听与 navigator 字段。 */
function fakeWindow(overrides: {onLine?: boolean; standalone?: boolean; serviceWorker?: unknown; userAgent?: string; maxTouchPoints?: number} = {}) {
  const listeners=new Map<string,Set<EventListener>>();
  const win={
    navigator:{onLine:overrides.onLine??true,serviceWorker:overrides.serviceWorker,standalone:overrides.standalone,
      userAgent:overrides.userAgent??'',maxTouchPoints:overrides.maxTouchPoints??0},
    addEventListener(type:string,handler:EventListener){(listeners.get(type)??listeners.set(type,new Set()).get(type)!).add(handler)},
    removeEventListener(type:string,handler:EventListener){listeners.get(type)?.delete(handler)},
    matchMedia:()=>({matches:false}),
    location:{reload:vi.fn()},
    dispatch(type:string,event:Record<string,unknown>={}){for(const h of listeners.get(type)??[])h(event as unknown as Event)}
  };
  return win as unknown as Window & {dispatch:(t:string,e?:Record<string,unknown>)=>void;location:{reload:()=>void}};
}

function memoryStorage():Storage{
  const map=new Map<string,string>();
  return {get length(){return map.size},clear:()=>map.clear(),getItem:k=>map.get(k)??null,
    key:i=>[...map.keys()][i]??null,removeItem:k=>{map.delete(k)},setItem:(k,v)=>{map.set(k,String(v))}} as Storage;
}

beforeEach(()=>{Object.assign(pwa,{online:true,canInstall:false,installed:false,updateReady:false,dismissed:false,swActive:false,iosHint:false})});

describe('PWA 状态',()=>{
  it('初次装配读取网络与被安装状态',()=>{
    const win=fakeWindow({onLine:false});
    const stop=initPwa({win,storage:memoryStorage()});
    expect(pwa.online).toBe(false);
    expect(pwa.installed).toBe(false);
    stop();
  });

  it('在线/离线事件实时更新状态，清理后不再响应',()=>{
    const win=fakeWindow();
    const stop=initPwa({win,storage:memoryStorage()});
    win.dispatch('offline');
    expect(pwa.online).toBe(false);
    win.dispatch('online');
    expect(pwa.online).toBe(true);
    stop();
    win.dispatch('offline');
    expect(pwa.online).toBe(true);
  });

  it('beforeinstallprompt 后可以安装，用户接受则标记已安装',async()=>{
    const win=fakeWindow();
    const stop=initPwa({win,storage:memoryStorage()});
    const prompt=vi.fn(async()=>{});
    win.dispatch('beforeinstallprompt',{preventDefault:vi.fn(),prompt,userChoice:Promise.resolve({outcome:'accepted'})});
    expect(pwa.canInstall).toBe(true);
    await expect(promptInstall()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledOnce();
    expect(pwa.installed).toBe(true);
    expect(pwa.canInstall).toBe(false);
    stop();
  });

  it('用户拒绝后记住选择，不再打扰',async()=>{
    const storage=memoryStorage();
    const win=fakeWindow();
    const stop=initPwa({win,storage});
    win.dispatch('beforeinstallprompt',{preventDefault:vi.fn(),prompt:async()=>{},userChoice:Promise.resolve({outcome:'dismissed'})});
    await expect(promptInstall()).resolves.toBe('dismissed');
    expect(storage.getItem('tempo.install.dismissed')).toBe('1');
    win.dispatch('beforeinstallprompt',{preventDefault:vi.fn(),prompt:async()=>{},userChoice:Promise.resolve({outcome:'accepted'})});
    expect(pwa.canInstall).toBe(false);
    stop();
  });

  it('没有捕获到安装事件时返回 unavailable',async()=>{
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('dismissInstall 写入持久标记',()=>{
    const storage=memoryStorage();
    dismissInstall(storage);
    expect(pwa.dismissed).toBe(true);
    expect(storage.getItem('tempo.install.dismissed')).toBe('1');
  });

  it('识别 iOS 独立窗口',()=>{
    expect(detectStandalone(fakeWindow({standalone:true}))).toBe(true);
    expect(detectStandalone(fakeWindow({standalone:false}))).toBe(false);
  });

  it('iOS Safari 给文字安装指引，安卓不触发',()=>{
    const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    const android='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
    const ipadDesktop='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
    expect(needsIosInstallHint(fakeWindow({userAgent:iphone}))).toBe(true);
    expect(needsIosInstallHint(fakeWindow({userAgent:android}))).toBe(false);
    expect(needsIosInstallHint(fakeWindow({userAgent:ipadDesktop,maxTouchPoints:5}))).toBe(true);  // iPadOS 默认桌面 UA
    expect(needsIosInstallHint(fakeWindow({userAgent:iphone,standalone:true}))).toBe(false);       // 已安装不再提示
  });

  it('有新版本等待时，更新动作发送 SKIP_WAITING',async()=>{
    const postMessage=vi.fn();
    const win=fakeWindow({serviceWorker:{
      controller:{},
      register:async()=>({waiting:{postMessage},installing:null,addEventListener(){}}),
      addEventListener(){},removeEventListener(){}
    }});
    const stop=initPwa({win,storage:memoryStorage(),register:true});
    await Promise.resolve();await Promise.resolve();
    expect(pwa.updateReady).toBe(true);
    applyUpdate();
    expect(postMessage).toHaveBeenCalledWith('SKIP_WAITING');
    stop();
  });
});
