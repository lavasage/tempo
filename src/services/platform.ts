import {Capacitor} from '@capacitor/core';
import {App} from '@capacitor/app';
import type {Router} from 'vue-router';

/** 原生返回统一进入路由，保留表单的离开守卫。Web继续使用浏览器历史。 */
export async function bindPlatformNavigation(router:Router){
  if(!Capacitor.isNativePlatform())return;
  await App.addListener('backButton',()=>{
    if(window.history.state?.back){router.back();return}
    const path=router.currentRoute.value.path;
    if(path.startsWith('/students/')){void router.replace('/students');return}
    if(path!=='/'){void router.replace('/');return}
    void App.minimizeApp();
  });
}
