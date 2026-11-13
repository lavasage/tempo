/**
 * 登录云函数：唯一的身份来源。
 * openid 由微信服务端注入 WXContext，客户端传什么参数都改不了它。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext();
  return { openid: OPENID || '', appid: APPID || '', unionid: UNIONID || '' };
};
