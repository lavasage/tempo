import {describe,it,expect} from 'vitest';
import {createOutbox,decodeOps,memoryStorage,outboxKey,type SyncOp} from './outbox';
import {seed} from '../mock/seed';

const op=(id:string):SyncOp=>({kind:'booking.status',id,status:'confirmed'});

function fixture() {
  const storage = new Map<string, string>();
  return {store: memoryStorage(storage), raw: storage};
}

describe('可靠提交队列', () => {
  it('成功即出队，队列清空后不残留存储', async () => {
    const {store, raw} = fixture();
    const key = outboxKey('coach-1');
    const sent: string[] = [];
    const box = createOutbox({key, storage: store, apply: async o => void sent.push((o as {id: string}).id)});
    box.push(op('a'));
    box.push(op('b'));
    expect(raw.get(key)).toBeTruthy();
    await box.drain();
    expect(sent).toEqual(['a', 'b']);
    expect(box.snapshot().ops).toHaveLength(0);
    expect(raw.get(key)).toBeUndefined();
  });

  it('失败保留队首并停住，重试从同一项继续，不重复提交已成功的项', async () => {
    const {store} = fixture();
    let fail = true;
    const sent: string[] = [];
    const box = createOutbox({
      key: outboxKey('coach-1'),
      storage: store,
      apply: async o => {
        const id = (o as {id: string}).id;
        if (fail && id === 'b') throw Error('网络中断');
        sent.push(id);
      }
    });
    box.push(op('a'));
    box.push(op('b'));
    box.push(op('c'));
    await box.drain();
    expect(sent).toEqual(['a']);
    expect(box.snapshot().ops.map(e => (e.op as {id: string}).id)).toEqual(['b', 'c']);
    expect(box.snapshot().ops[0]!.attempts).toBe(1);
    expect(box.snapshot().error).toBe('网络中断');

    fail = false;
    await box.drain();
    expect(sent).toEqual(['a', 'b', 'c']);
    expect(box.snapshot().error).toBe('');
    expect(box.snapshot().lastOk).toBeTypeOf('number');
  });

  it('刷新后从磁盘接回未提交的操作', async () => {
    const {store, raw} = fixture();
    const key = outboxKey('coach-1');
    const first = createOutbox({key, storage: store, apply: async () => {}});
    first.push(op('a'));
    const persisted = raw.get(key)!;

    // 模拟刷新：同一份存储、新的实例。
    const second = createOutbox({key, storage: store, apply: async () => {}});
    expect(second.restore().ops.map(e => (e.op as {id: string}).id)).toEqual(['a']);
    expect(persisted).toContain('booking.status');
  });

  it('不同账号分键，互不串队', () => {
    const {raw} = fixture();
    const a = outboxKey('coach-a'), b = outboxKey('coach-b');
    expect(a).not.toBe(b);
    expect(raw.size).toBe(0);
  });

  it('存储损坏时安全降级为空队列', () => {
    const {store} = fixture();
    const key = outboxKey('coach-1');
    store.write(key, '{not json');
    const box = createOutbox({key, storage: store, apply: async () => {}});
    expect(box.restore().ops).toEqual([]);
    store.write(key, JSON.stringify([{op: {kind: 'unknown'}}, {nope: true}]));
    expect(decodeOps(store.read(key))).toEqual([]);
  });

  it('丢弃队列会同时清掉存储', () => {
    const {store, raw} = fixture();
    const key = outboxKey('coach-1');
    const box = createOutbox({key, storage: store, apply: async () => {}});
    box.push(op('a'));
    expect(raw.get(key)).toBeTruthy();
    box.clear();
    expect(raw.get(key)).toBeUndefined();
    expect(box.snapshot().ops).toEqual([]);
  });
});

describe('队列操作的幂等前提', () => {
  it('预约创建用课程 id 做请求键，重放不会产生第二节课', () => {
    const d = seed();
    const booking = d.bookings[0]!;
    // 队列保存的是完整课程对象，重放时 id 不变，服务端据此判断已存在。
    expect(booking.id).toBeTruthy();
    const envelope: SyncOp = {kind: 'booking.create', booking};
    expect(JSON.parse(JSON.stringify(envelope)).booking.id).toBe(booking.id);
  });
});
