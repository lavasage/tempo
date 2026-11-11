import {createApp} from 'vue';
import {createPinia} from 'pinia';
import {createRouter,createWebHashHistory} from 'vue-router';
import App from './App.vue';
import Availability from '../views/Availability.vue';
import Calendar from '../views/Calendar.vue';
import StudentEditor from '../views/StudentEditor.vue';
import Students from '../views/Students.vue';
import Editor from '../views/Editor.vue';
import Login from '../views/Login.vue';
import {useAuth} from '../stores/auth';
import {useTempo} from '../stores/tempo';
import {initPwa} from '../services/pwa';
import {bootRemote} from './boot';
import '../styles/main.css';

const router=createRouter({
 history:createWebHashHistory(),
 scrollBehavior(to,from,saved){return saved||(to.path===from.path?false:{top:0})},
 routes:[
  {path:'/login',component:Login},
  {path:'/availability',component:Availability},
  // 排课与课程详情是课表的子路由：抽屉打开时课表保持挂载，关闭即回到原上下文。
  {path:'/',component:Calendar,children:[
   {path:'create',component:Editor},
   {path:'booking/:id',component:Editor}
  ]},
  {path:'/students',component:Students},
  {path:'/students/new',component:StudentEditor},
  {path:'/students/:id/edit',component:StudentEditor},
  {path:'/students/:id',component:Students}
 ]
});

router.beforeEach(async to=>{
 const auth=useAuth();
 if(!auth.ready)await auth.init();
 if(auth.mode==='local')return to.path==='/login'?{path:'/',replace:true}:true;
 if(!auth.signedIn)return to.path==='/login'?true:{path:'/login',replace:true};
 if(to.path==='/login')return {path:'/',replace:true};
 const tempo=useTempo();
 // 会话已存在（刷新页面）时补拉快照；失败留在当前页由界面提示重试。
 if(!tempo.hydrated){try{await bootRemote()}catch{return true}}
 return true;
});

// 生产构建注册 Service Worker；开发时可用 ?sw=1 手动验证离线。
initPwa({register:import.meta.env.PROD||location.search.includes('sw=1')});

const app=createApp(App);
app.use(createPinia()).use(router).mount('#app');
