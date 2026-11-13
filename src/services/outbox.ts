/**
 * 可靠提交（outbox）：
 * 远端写操作先进队列并落盘，成功才出队；刷新、断网、崩溃后能继续推送。
 * 队列是「至少一次」语义，因此每个操作都必须幂等：预约创建用课程 id 做请求键，
 * 状态变更与 upsert 天然可重放。
 */
import type {AvailabilitySettings,Booking,CourseType,Status,Student,TrainingReview} from '../types';

export type SyncOp =
  | {kind: 'student.save'; student: Student}
  | {kind: 'type.save'; type: CourseType; coachId: string}
  | {kind: 'booking.create'; booking: Booking}
  | {kind: 'booking.update'; booking: Booking}
  | {kind: 'booking.status'; id: string; status: Status}
  | {kind: 'review.save'; review: TrainingReview}
  | {kind: 'availability.save'; settings: AvailabilitySettings};

export interface SyncEnvelope {
  /** 本地唯一标识，便于排查与展示，不参与服务端判断。 */
  id: string;
  createdAt: string;
  attempts: number;
  op: SyncOp;
}

export interface OutboxStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export interface OutboxSnapshot {
  ops: SyncEnvelope[];
  error: string;
  lastOk: number | null;
}

const KINDS = new Set(['student.save','type.save','booking.create','booking.update','booking.status','review.save','availability.save']);

/** 队列按账号隔离：换账号不会互相推送。 */
export function outboxKey(coachId: string) {
  return `tempo.outbox.v1:${coachId || 'anon'}`;
}

export function browserStorage(): OutboxStorage {
  const memory = new Map<string, string>();
  const available = (() => {
    try {
      return typeof localStorage !== 'undefined' && !!localStorage;
    } catch {
      return false;
    }
  })();
  if (!available) return memoryStorage(memory);
  return {
    read: key => {
      try {
        return localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    write: (key, value) => {
      memory.set(key, value);
      try {
        localStorage.setItem(key, value);
      } catch {
        /* 配额或隐私模式：退化为内存，界面仍可用 */
      }
    },
    remove: key => {
      memory.delete(key);
      try {
        localStorage.removeItem(key);
      } catch {
        /* 同上 */
      }
    }
  };
}

export function memoryStorage(seed: Map<string, string> = new Map()): OutboxStorage {
  return {
    read: key => seed.get(key) ?? null,
    write: (key, value) => void seed.set(key, value),
    remove: key => void seed.delete(key)
  };
}

/** 解析落盘内容；损坏或被裁剪的条目直接丢弃，不能让坏数据挡住启动。 */
export function decodeOps(raw: string | null): SyncEnvelope[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ops: SyncEnvelope[] = [];
  for (const item of parsed) {
    const value = item as Partial<SyncEnvelope> | null;
    const op = value?.op as SyncOp | undefined;
    if (!value || !op || typeof op !== 'object' || !KINDS.has((op as {kind?: string}).kind ?? '')) continue;
    ops.push({
      id: typeof value.id === 'string' ? value.id : crypto.randomUUID(),
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
      attempts: Number.isInteger(value.attempts) && (value.attempts as number) >= 0 ? (value.attempts as number) : 0,
      op
    });
  }
  return ops;
}

export function createOutbox(options: {
  key: string;
  storage: OutboxStorage;
  apply: (op: SyncOp) => Promise<unknown>;
  onChange?: (snapshot: OutboxSnapshot) => void;
}) {
  const {key, storage, apply, onChange} = options;
  let ops = decodeOps(storage.read(key));
  let error = '';
  let lastOk: number | null = null;
  let running = false;

  const snapshot = (): OutboxSnapshot => ({ops: [...ops], error, lastOk});
  const emit = () => onChange?.(snapshot());
  function persist() {
    if (ops.length) storage.write(key, JSON.stringify(ops));
    else storage.remove(key);
  }

  function push(op: SyncOp) {
    ops.push({id: crypto.randomUUID(), createdAt: new Date().toISOString(), attempts: 0, op});
    persist();
    emit();
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (ops.length) {
        const head = ops[0]!;
        try {
          await apply(head.op);
          ops.shift();
          error = '';
          lastOk = Date.now();
          persist();
          emit();
        } catch (e) {
          head.attempts += 1;
          error = e instanceof Error ? e.message : '同步失败，请稍后重试';
          persist();
          emit();
          break;
        }
      }
    } finally {
      running = false;
      emit();
    }
  }

  /** 启动时把上次未提交的操作接回来；存储损坏不会抛出。 */
  function restore() {
    ops = decodeOps(storage.read(key));
    error = '';
    emit();
    return snapshot();
  }

  function clear() {
    ops = [];
    error = '';
    lastOk = null;
    storage.remove(key);
    emit();
  }

  return {push, drain, restore, clear, snapshot};
}

export type Outbox = ReturnType<typeof createOutbox>;
