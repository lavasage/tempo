import type {Database} from '../types';
import {defaultAvailability} from '../services/availability';
import {dateKey} from '../composables/date';
export function seed():Database{const now=new Date().toISOString(),cid=crypto.randomUUID();const types=['力量训练','功能训练','普拉提'].map((name,i)=>({id:crypto.randomUUID(),name,default_duration:60,color:['#ff7052','#4263eb','#0e9f8e'][i]!}));
 const roster=[['林晓','12 周改善圆肩，能完成标准硬拉','改善体态，循序渐进'],['陈宇','提升深蹲 1RM 到 100kg','专注基础力量'],['王可欣','体脂降到 22%，保持每周三练','喜欢上午训练'],['赵一鸣','增肌期，重点关注肩背','时间不固定，提前一天确认'],['周宁','产后恢复核心与盆底功能','避免高冲击动作']];
 const students=roster.map(([name,goal,notes],i)=>({id:crypto.randomUUID(),coach_id:cid,name:name!,phone:`1380000000${i}`,goal:goal!,notes:notes!,created_at:now,preferences:[types[i%3]!.id]}));return {availability:defaultAvailability(),booking_events:[],reviews:[],coach:{id:cid,name:'Alex',email:'demo@tempo.local',created_at:now},types,students,bookings:[9,11,14,17].map((h,i)=>({id:crypto.randomUUID(),coach_id:cid,student_id:students[i]!.id,course_type_id:types[i%3]!.id,start_at:new Date(`${dateKey()}T${String(h).padStart(2,'0')}:00`).toISOString(),end_at:new Date(`${dateKey()}T${String(h+1).padStart(2,'0')}:00`).toISOString(),status:i===2?'pending':'confirmed',notes:'',created_at:now,updated_at:now}))}}

