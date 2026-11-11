import type {Booking,Database,Student} from '../types';
import {dateKey} from '../composables/date';

export type StudentInput = Pick<Student,'name'|'phone'|'notes'|'preferences'|'goal'>;
export type CourseFilter = 'all'|'upcoming'|'completed'|'pending'|'cancelled';
export interface StudentCourseFilters {status:CourseFilter;type:string;from:string;to:string}

export function normalizePhone(phone:string){return phone.replace(/[\s()\-]/g,'')}
export function studentInput(data:Database,input:StudentInput):StudentInput {
  const name=input.name.trim(),phone=normalizePhone(input.phone),notes=input.notes.trim(),goal=(input.goal??'').trim();
  if(!name||name.length>40)throw Error('姓名需为 1–40 个字');
  if(phone&&!/^\+?\d{7,15}$/.test(phone))throw Error('请输入有效联系电话（7–15 位数字）');
  if(notes.length>1000)throw Error('备注最多 1000 字');
  if(goal.length>200)throw Error('训练目标最多 200 字');
  if(input.preferences.some(id=>!data.types.some(t=>t.id===id)))throw Error('课程偏好已失效，请重新选择');
  return {name,phone,notes,goal,preferences:[...new Set(input.preferences)]};
}
export function createStudent(data:Database,input:StudentInput,id:string=crypto.randomUUID(),now=new Date()):Database {
  if(data.students.some(s=>s.id===id))throw Error('学员已保存，请勿重复提交');
  const student:Student={...studentInput(data,input),id,coach_id:data.coach.id,created_at:now.toISOString()};
  return {...data,students:[...data.students,student]};
}
export function updateStudent(data:Database,id:string,input:StudentInput):Database {
  const student=data.students.find(s=>s.id===id&&s.coach_id===data.coach.id);
  if(!student)throw Error('学员不存在或不属于当前教练');
  const next={...student,...studentInput(data,input)};
  return {...data,students:data.students.map(s=>s.id===id?next:s)};
}
export function searchStudents(data:Database,search:string):Student[] {
  const query=search.trim().toLocaleLowerCase(),phone=normalizePhone(query);
  return data.students.filter(s=>s.coach_id===data.coach.id&&(!query||s.name.toLocaleLowerCase().includes(query)||(phone&&normalizePhone(s.phone).includes(phone))));
}
function ownedCourses(data:Database,id:string):Booking[]{
  if(!data.students.some(s=>s.id===id&&s.coach_id===data.coach.id))return [];
  return data.bookings.filter(b=>b.student_id===id&&b.coach_id===data.coach.id);
}
export function studentSummary(data:Database,id:string,now=new Date()){
  const courses=ownedCourses(data,id);
  const completed=courses.filter(b=>b.status==='completed'&&Date.parse(b.start_at)<=now.getTime()).sort((a,b)=>Date.parse(b.start_at)-Date.parse(a.start_at));
  const active=courses.filter(b=>['confirmed','pending'].includes(b.status)&&Date.parse(b.end_at)>now.getTime());
  return {completed:completed.length,active:active.length,last:completed[0]?.start_at??null};
}
export function filterStudentCourses(data:Database,id:string,filters:StudentCourseFilters,now=new Date()):Booking[] {
  if(filters.from&&filters.to&&filters.from>filters.to)return [];
  const rows=ownedCourses(data,id).filter(b=>{
    const day=dateKey(new Date(b.start_at));
    if((filters.type&&b.course_type_id!==filters.type)||(filters.from&&day<filters.from)||(filters.to&&day>filters.to))return false;
    if(filters.status==='upcoming')return b.status==='confirmed'&&Date.parse(b.end_at)>now.getTime();
    return filters.status==='all'||b.status===filters.status;
  });
  const ascending=filters.status==='upcoming'||filters.status==='pending';
  return rows.sort((a,b)=>(Date.parse(a.start_at)-Date.parse(b.start_at))*(ascending?1:-1));
}
