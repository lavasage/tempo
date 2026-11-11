<script setup lang="ts">
import {computed, onUnmounted, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import {CalendarDays, Users, Plus, Activity, X, Check, RefreshCw, WifiOff, Download, ArrowUpCircle} from 'lucide-vue-next';
import {useTempo} from '../stores/tempo';
import {useAuth} from '../stores/auth';
import {useSync} from '../stores/sync';
import {usePwa} from '../stores/pwa';
import {bootRemote} from './boot';
import {formatCachedAt, clearCache} from '../services/offline';
import '../styles/workbench.css';

const store = useTempo();
const auth = useAuth();
const sync = useSync();
const route = useRoute();
const router = useRouter();
const {state: pwa, install, dismiss, update} = usePwa();

let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => store.notice,
  message => {
    clearTimeout(timer);
    if (message) timer = setTimeout(() => (store.notice = ''), 4500);
  }
);
onUnmounted(() => clearTimeout(timer));

/** 离线说明：远端模式区分「有缓存」与「实时在线」，本地演示始终可用。 */
const offlineText = computed(() => {
  if (!store.remote) return '已离线 · 演示数据保存在本机，功能不受影响';
  if (store.cachedAt) return `已离线 · 显示 ${formatCachedAt(store.cachedAt)} 同步的数据，修改需联网`;
  return '已离线 · 只能查看已有数据，修改需联网';
});

const initials = computed(() => (store.data.coach.name || 'T').slice(-2).toUpperCase());
const coachLabel = computed(() => store.data.coach.name || '教练');

/** 恢复网络后先补发队列，队列清空再拉一次快照对齐服务端。 */
watch(
  () => pwa.online,
  async online => {
    if (!online || !store.remote || !auth.signedIn || !store.hydrated) return;
    await sync.retry();
    if (sync.pending === 0 && !sync.error)
      try {
        await bootRemote();
      } catch {
        /* 保持当前数据，界面已有提示 */
      }
  }
);

function reset() {
  if (confirm('重置全部演示数据？你创建和修改的课程将被清除。'))
    try {
      store.reset();
    } catch (e) {
      store.error = String(e);
    }
}

/** hash 路由下 #main 会被当成路由地址，这里拦下默认跳转，只把焦点交给正文。 */
function focusMain() {
  const el = document.getElementById('main');
  if (!el) return;
  el.focus();
  el.scrollIntoView({block: 'start'});
}

async function signOut() {
  if (!confirm('退出登录？未同步的改动将丢失。')) return;
  await auth.signOut();
  sync.reset();
  store.reset();
  clearCache();
  await router.replace('/login');
}

async function retryBoot() {
  try {
    await bootRemote();
  } catch (e) {
    store.error = e instanceof Error ? e.message : '读取账号数据失败，请稍后重试';
  }
}
</script>

<template>
  <a class="skip-link" href="#main" @click.prevent="focusMain">跳到主要内容</a>

  <div v-if="!auth.ready" class="app-loading">正在载入…</div>

  <RouterView v-else-if="route.path === '/login'" />

  <div v-else class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#/" aria-label="Tempo 首页">
        <span class="brand-mark"><Activity :size="20" aria-hidden="true" /></span>
        <span class="brand-word">tempo</span>
        <span class="brand-sub">教练工作台</span>
      </a>

      <nav class="nav" aria-label="主导航">
        <RouterLink to="/" :class="{'section-active': route.path.startsWith('/booking') || route.path === '/availability'}">
          <CalendarDays aria-hidden="true" />课表
        </RouterLink>
        <RouterLink to="/students" :class="{'section-active': route.path.startsWith('/students')}">
          <Users aria-hidden="true" />学员
        </RouterLink>
        <RouterLink to="/create"><Plus aria-hidden="true" />新建课程</RouterLink>
      </nav>

      <div class="sidebar-foot">
        <div class="coach-chip">
          <span class="avatar">{{ initials }}</span>
          <div>
            <b>{{ coachLabel }}</b>
            <small>{{ store.remote ? auth.email : '本地演示' }}</small>
          </div>
        </div>
        <button v-if="store.remote" class="text" @click="signOut">退出登录</button>
        <button v-else class="text" @click="reset">重置演示数据</button>
      </div>
    </aside>

    <main id="main" class="app-main" tabindex="-1">
      <div class="page">
        <div class="status-stack" aria-live="polite">
          <p v-if="!pwa.online" class="banner banner-offline" role="status">
            <WifiOff :size="15" aria-hidden="true" /><span>{{ offlineText }}</span>
          </p>
          <p v-if="pwa.updateReady" class="banner banner-update" role="status">
            <ArrowUpCircle :size="15" aria-hidden="true" /><span>新版本已就绪</span>
            <button @click="update()">立即更新</button>
          </p>
          <div v-if="store.error" role="alert" class="error">
            {{ store.error }}<button v-if="!store.remote" @click="reset">重置演示数据</button>
          </div>
          <div v-if="sync.error" role="alert" class="error sync-error">
            同步失败：{{ sync.error }}<button @click="sync.retry()"><RefreshCw :size="14" aria-hidden="true" />重试</button>
          </div>
          <p v-else-if="sync.pending" class="sync-pending" role="status">正在同步 {{ sync.pending }} 项…</p>
        </div>

        <section v-if="pwa.canInstall || pwa.iosHint" class="install-card" aria-labelledby="install-title">
          <div>
            <Download :size="18" aria-hidden="true" />
            <div>
              <b id="install-title">把 Tempo 装到桌面</b>
              <p v-if="pwa.canInstall">训练现场直接打开，断网也能看课表和学员。</p>
              <p v-else>在 Safari 点底部「分享」→「添加到主屏幕」，就能像 App 一样打开。</p>
            </div>
          </div>
          <div class="install-actions">
            <button v-if="pwa.canInstall" class="primary" @click="install()">安装</button>
            <button class="text" @click="dismiss()">{{ pwa.canInstall ? '以后再说' : '知道了' }}</button>
          </div>
        </section>

        <RouterView v-if="!store.blocked && store.hydrated" />
        <p v-else-if="store.remote && !store.hydrated" class="app-loading">
          正在读取账号数据… <button class="text" @click="retryBoot">重试</button>
        </p>

        <footer class="mobile-foot mobile-only">
          <template v-if="store.remote">
            <button class="text" @click="signOut">退出登录</button>
            <span>·</span>{{ auth.email }}
          </template>
          <template v-else>
            <button class="text" @click="reset">重置演示数据</button>
            <span>·</span>本地演示
          </template>
        </footer>
      </div>
    </main>

    <!-- 全局操作提示：作为页面级状态区播报保存/确认结果 -->
    <div v-if="store.notice" class="app-notice" role="status">
      <Check :size="16" aria-hidden="true" />
      <p>{{ store.notice }}</p>
      <button aria-label="关闭提示" @click="store.notice = ''"><X :size="16" aria-hidden="true" /></button>
    </div>
  </div>
</template>
