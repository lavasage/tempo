/** 本地 UUID：小程序没有 crypto.randomUUID，用时间 + 随机数拼一个足够唯一的串。 */
let counter = 0;
export function uid() {
  counter = (counter + 1) % 100000;
  return `id-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
