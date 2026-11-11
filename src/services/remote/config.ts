export interface RemoteConfig {url: string; key: string}

/**
 * 只有同时提供 URL 与 anon key 才进入远端模式；否则保持本地演示。
 * 只读取 anon key：service_role 绝不能进前端构建产物。
 */
export function remoteConfig(env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>): RemoteConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim();
  const key = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !key) return null;
  if (!/^https?:\/\/[^\s]+$/.test(url)) return null;
  return {url: url.replace(/\/+$/, ''), key};
}
