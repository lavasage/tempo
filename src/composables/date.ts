export function dateKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function shift(d:string,n:number){const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return dateKey(x)}
export function time(s:string){return new Date(s).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}
