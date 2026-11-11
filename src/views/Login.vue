<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Activity, ArrowRight } from 'lucide-vue-next';
import { useAuth } from '../stores/auth';
import { bootRemote } from '../app/boot';
import { PulseMark } from '../components/ui';
import '../styles/login.css';

const auth = useAuth();
const router = useRouter();
const signup = ref(false);
const email = ref('');
const password = ref('');
const name = ref('');
const hint = ref('');
const booting = ref(false);

async function submit() {
  hint.value = '';
  if (auth.mode === 'local') {
    await router.replace('/');
    return;
  }
  booting.value = true;
  try {
    if (signup.value) {
      const ok = await auth.signUp(email.value, password.value, name.value);
      if (!ok) {
        hint.value = '注册成功，请完成邮箱确认后再登录';
        signup.value = false;
        return;
      }
    } else await auth.signIn(email.value, password.value);
    await bootRemote();
    await router.replace('/');
  } catch (e) {
    hint.value = e instanceof Error ? e.message : '登录失败，请稍后重试';
  } finally {
    booting.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <aside class="login-brand-panel">
      <div class="login-wordmark">
        <span class="brand-mark"><Activity :size="20" aria-hidden="true" /></span>
        <b>tempo</b>
        <span class="brand-sub">教练工作台</span>
      </div>
      <PulseMark class="login-pulse" :width="420" :height="100" color="rgba(213,250,69,.5)" :stroke="2" />
      <div class="login-pitch">
        <h2>把每一节课，<br />排得刚刚好。</h2>
        <p>排课、学员档案、训练回顾，一个工作台完成。</p>
      </div>
      <p class="login-tagline">Energetic by Nature. Precise by Design.</p>
    </aside>

    <form class="login-card" @submit.prevent="submit">
      <div class="login-card-brand mobile-only">
        <span class="brand-mark"><Activity :size="18" aria-hidden="true" /></span>
        <b>tempo</b>
      </div>
      <h1>{{ signup ? '创建账号' : '登录' }}</h1>
      <p v-if="auth.mode === 'local'" class="login-note">当前为本地演示模式，数据只保存在这台设备，无需登录。</p>
      <p v-else class="login-note">用教练账号登录，课程与学员按账号隔离同步。</p>

      <template v-if="auth.mode === 'remote'">
        <label v-if="signup">姓名<input v-model="name" autocomplete="name" maxlength="40" required /></label>
        <label>邮箱<input v-model="email" type="email" autocomplete="email" required /></label>
        <label>密码<input v-model="password" type="password" :autocomplete="signup ? 'new-password' : 'current-password'" minlength="6" required /></label>
        <p v-if="hint || auth.error" class="error" role="alert">{{ hint || auth.error }}</p>
        <button class="primary login-submit" type="submit" :disabled="booting || auth.busy">
          {{ booting || auth.busy ? '请稍候…' : signup ? '注册并登录' : '登录' }}
          <ArrowRight v-if="!booting && !auth.busy" :size="16" />
        </button>
        <button class="text login-switch" type="button" @click="signup = !signup; hint = ''">{{ signup ? '已有账号，去登录' : '没有账号？注册' }}</button>
      </template>
      <button v-else class="primary login-submit" type="submit">进入演示 <ArrowRight :size="16" /></button>
    </form>
  </div>
</template>
