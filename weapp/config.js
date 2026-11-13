/**
 * 环境配置：上线前只改这一个文件。
 *
 * cloudEnv 填微信云开发的环境 ID（形如 tempo-prod-8gxxxxxxxxxxxx）。
 * 留空时小程序自动退回「纯本机」模式，页面照常可用，只是不跨设备同步。
 */
export const config = {
  cloudEnv: '',
  stateCollection: 'state',
  syncThrottle: 1500
};

export default config;
