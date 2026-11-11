import type {RemoteConfig} from './config';

export class RemoteError extends Error {
  constructor(message: string, readonly status = 0, readonly code?: string) { super(message); }
}

export interface ApiClient {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  upsert(table: string, rows: unknown[], onConflict?: string): Promise<void>;
}

const FRIENDLY: Record<string, string> = {
  '23505': '记录已存在，请勿重复提交',
  '23503': '关联数据不存在或已失效',
  '23514': '数据不符合约束',
  '42501': '没有权限执行该操作',
  '28000': '登录已失效，请重新登录',
  'PGRST301': '登录已失效，请重新登录'
};

function messageFor(status: number, body: unknown) {
  const detail = (body ?? {}) as {message?: string; code?: string; details?: string};
  if (status === 401) return FRIENDLY['PGRST301']!;
  if (detail.message) return FRIENDLY[detail.code ?? ''] && detail.code === '23505' ? FRIENDLY['23505']! : detail.message;
  return `请求失败（${status}）`;
}

export function createApiClient(options: {
  config: RemoteConfig;
  token: () => string | null;
  fetchImpl?: typeof fetch;
}): ApiClient {
  const {config, token} = options;
  const doFetch = options.fetchImpl ?? fetch;

  async function post(path: string, body: unknown, prefer?: string): Promise<unknown> {
    const session = token();
    if (!session) throw new RemoteError('登录已失效，请重新登录', 401, 'PGRST301');
    const response = await doFetch(`${config.url}/rest/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${session}`,
        'Content-Type': 'application/json',
        ...(prefer ? {Prefer: prefer} : {})
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      let parsed: unknown = null;
      try { parsed = await response.json(); } catch { /* 非 JSON 响应 */ }
      const code = (parsed as {code?: string} | null)?.code;
      throw new RemoteError(messageFor(response.status, parsed), response.status, code);
    }
    return response.status === 204 ? null : response.json().catch(() => null);
  }

  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      return await post(`rpc/${fn}`, args) as T;
    },
    async upsert(table, rows, onConflict) {
      if (!rows.length) return;
      const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
      await post(`${table}${query}`, rows, 'resolution=merge-duplicates,return=minimal');
    }
  };
}
