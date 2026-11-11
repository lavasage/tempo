import {defineStore} from 'pinia';
import {applyUpdate,dismissInstall,promptInstall,pwa} from '../services/pwa';

/** 把 PWA 状态接到 Pinia，视图里直接读 state、点按钮调动作。 */
export const usePwa=defineStore('pwa',()=>({
 state:pwa,
 install:promptInstall,
 dismiss:()=>dismissInstall(),
 update:applyUpdate
}));
