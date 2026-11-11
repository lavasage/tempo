import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

/**
 * 把构建产物清单注入 dist/sw.js：首次访问装好 Service Worker 后即可离线打开。
 * 不引入额外依赖，产物里的 hash 文件名由构建结果决定。
 */
function swPrecache(){
 return {
  name:'tempo-sw-precache',
  apply:'build' as const,
  closeBundle(){
   const dir=resolve('dist');
   let assets:string[];
   try{assets=readdirSync(join(dir,'assets')).map(f=>`/assets/${f}`)}catch{return}
   const file=join(dir,'sw.js');
   const source=readFileSync(file,'utf8');
   writeFileSync(file,source.replace('self.__PRECACHE__',JSON.stringify(assets)));
  }
 };
}

export default defineConfig({plugins:[vue(),tailwind(),swPrecache()]});
