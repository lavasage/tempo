import {defineStore} from 'pinia';
import {ref} from 'vue';
export const useNavigation=defineStore('navigation',()=>{
  const search=ref('');
  return {search};
});
