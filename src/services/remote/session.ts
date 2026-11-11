import type {RemoteConfig} from './config';

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: {id: string; email: string};
}

const KEY = 'tempo.session.v1';
type FetchLike = typeof fetch;

export function readSession(storage: Storage = localStorage): Session | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const s = parsed as Session;
    if (!s?.access_token || !s.refresh_token || !s.user?.id) return null;
    return s;
  } catch {
    return null;
  }
}

export function writeSession(session: Session, storage: Storage = localStorage) {
  storage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(storage: Storage = localStorage) {
  storage.removeItem(KEY);
}

/** GoTrue 响应 → 会话；expires_in 是秒，这里换算成绝对时间。 */
export function toSession(payload: Record<string, unknown>): Session {
  const user = (payload.user ?? {}) as {id?: string; email?: string};
  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    access_token: String(payload.access_token ?? ''),
    refresh_token: String(payload.refresh_token ?? ''),
    expires_at: Date.now() + Math.max(0, expiresIn - 30) * 1000,
    user: {id: String(user.id ?? ''), email: String(user.email ?? '')}
  };
}

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as {msg?: string; message?: string; error_description?: string; error?: string};
    return body.msg || body.message || body.error_description || body.error || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

async function authPost(cfg: RemoteConfig, path: string, body: unknown, token: string | null, fetchImpl: FetchLike) {
  const response = await fetchImpl(`${cfg.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: cfg.key,
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {})
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new AuthError(await readError(response), response.status);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function signInRequest(cfg: RemoteConfig, email: string, password: string, fetchImpl: FetchLike = fetch): Promise<Session> {
  if (!email.trim() || !password) throw new AuthError('请填写邮箱和密码');
  const payload = await authPost(cfg, 'token?grant_type=password', {email: email.trim(), password}, null, fetchImpl);
  const session = toSession(payload);
  if (!session.access_token || !session.user.id) throw new AuthError('登录响应缺少会话信息');
  return session;
}

export async function signUpRequest(cfg: RemoteConfig, email: string, password: string, name: string, fetchImpl: FetchLike = fetch): Promise<Session | null> {
  if (!email.trim() || password.length < 6) throw new AuthError('邮箱必填，密码至少 6 位');
  const payload = await authPost(cfg, 'signup', {email: email.trim(), password, data: {name: name.trim()}}, null, fetchImpl);
  return payload.access_token ? toSession(payload) : null; // 需要邮箱确认时不返回会话
}

export async function refreshRequest(cfg: RemoteConfig, session: Session, fetchImpl: FetchLike = fetch): Promise<Session> {
  const payload = await authPost(cfg, 'token?grant_type=refresh_token', {refresh_token: session.refresh_token}, null, fetchImpl);
  const next = toSession(payload);
  if (!next.access_token) throw new AuthError('会话续期失败');
  return {...next, user: next.user.id ? next.user : session.user};
}

export async function signOutRequest(cfg: RemoteConfig, session: Session, fetchImpl: FetchLike = fetch) {
  try {
    await authPost(cfg, 'logout', {}, session.access_token, fetchImpl);
  } catch {
    // 网络失败也要清掉本地会话，避免卡在登录态。
  }
}
