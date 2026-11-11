import {defineStore} from 'pinia';
import {computed,ref} from 'vue';
import {remoteConfig,type RemoteConfig} from '../services/remote/config';
import {
  AuthError,clearSession,readSession,refreshRequest,signInRequest,signOutRequest,signUpRequest,writeSession,type Session
} from '../services/remote/session';

/**
 * 认证：配置了 Supabase 就走邮箱登录；没配置则保持本地演示（无需登录）。
 * 未登录时路由守卫把它挡在 /login，业务视图拿不到数据。
 */
export const useAuth=defineStore('auth',()=>{
 const config:RemoteConfig|null=remoteConfig();
 const mode: 'local' | 'remote'=config?'remote':'local';
 const session=ref<Session|null>(config?readSession():null);
 const ready=ref(mode==='local');
 const busy=ref(false),error=ref('');
 const email=computed(()=>session.value?.user.email??'');
 const userId=computed(()=>session.value?.user.id??'');
 const signedIn=computed(()=>mode==='local'||!!session.value?.access_token);

 function token(){return session.value?.access_token??null}

 async function init(){
  if(!config){ready.value=true;return}
  if(session.value&&session.value.expires_at<=Date.now()){
   try{const next=await refreshRequest(config,session.value);session.value=next;writeSession(next)}
   catch{session.value=null;clearSession()}
  }
  ready.value=true;
 }

 async function signIn(mail:string,password:string){
  if(!config)return;
  busy.value=true;error.value='';
  try{const next=await signInRequest(config,mail,password);session.value=next;writeSession(next)}
  catch(e){error.value=e instanceof AuthError?e.message:'登录失败，请检查网络';throw e}
  finally{busy.value=false}
 }

 /** 返回 true 表示已直接登录；false 表示需要先完成邮箱确认。 */
 async function signUp(mail:string,password:string,name:string){
  if(!config)return false;
  busy.value=true;error.value='';
  try{
   const next=await signUpRequest(config,mail,password,name);
   if(!next)return false;
   session.value=next;writeSession(next);
   return true;
  }catch(e){error.value=e instanceof AuthError?e.message:'注册失败，请稍后重试';throw e}
  finally{busy.value=false}
 }

 async function signOut(){
  if(config&&session.value)await signOutRequest(config,session.value);
  session.value=null;clearSession();error.value='';
 }

 return {mode,ready,signedIn,busy,error,email,userId,token,init,signIn,signUp,signOut};
});
