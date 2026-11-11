import {describe,it,expect,vi,afterEach} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {seed} from '../mock/seed';
import {createStudent,updateStudent,searchStudents,filterStudentCourses,studentSummary} from './students';
import {useTempo} from '../stores/tempo';
import {createLocalRepository} from '../repositories/local';
const input={name:'  徐安  ',phone:'+86 (138) 1234-5678',notes:'  肩部训练  ',preferences:[] as string[]};
const now=new Date('2026-11-11T12:00:00+08:00');
afterEach(()=>vi.unstubAllGlobals());
describe('学员档案',()=>{
 it('创建规范化字段和UUID，编辑保留归属与注册时间',()=>{const d=seed(),next=createStudent(d,input,undefined,now),s=next.students.at(-1)!;expect(s.name).toBe('徐安');expect(s.phone).toBe('+8613812345678');expect(s.id).toMatch(/^[\da-f-]{36}$/);expect(d.students).toHaveLength(5);const edited=updateStudent(next,s.id,{...input,name:'徐安安',phone:''});expect(edited.students.at(-1)).toMatchObject({id:s.id,coach_id:d.coach.id,created_at:now.toISOString(),name:'徐安安',phone:''});expect(edited.bookings).toEqual(d.bookings)});
 it('拒绝空姓名、非法号码、超长字段和未知偏好',()=>{const d=seed();for(const patch of [{name:' '},{name:'名'.repeat(41)},{phone:'abc12345'},{phone:'123'},{phone:'1'.repeat(16)},{notes:'x'.repeat(1001)},{preferences:['missing']}])expect(()=>createStudent(d,{...input,...patch})).toThrow()});
 it('相同提交ID不可重复创建，未知或其他教练学员不可编辑',()=>{const d=createStudent(seed(),input,'new');expect(()=>createStudent(d,input,'new')).toThrow('重复');expect(()=>updateStudent(d,'missing',input)).toThrow();d.students[0]!.coach_id='other';expect(()=>updateStudent(d,d.students[0]!.id,input)).toThrow()});
 it('偏好去重，姓名/格式化号码搜索忽略前后空白且限定教练',()=>{const d=seed();const next=createStudent(d,{...input,preferences:[d.types[0]!.id,d.types[0]!.id]});expect(next.students.at(-1)!.preferences).toHaveLength(1);expect(searchStudents(next,' 徐安 ')).toHaveLength(1);expect(searchStudents(next,'138-1234')).toHaveLength(1);next.students.at(-1)!.coach_id='other';expect(searchStudents(next,'徐安')).toHaveLength(0)});
 it('拒绝写入失败，重试后刷新恢复新档案与编辑',()=>{let raw:string|null=null,fail=false;vi.stubGlobal('localStorage',{getItem:()=>raw,setItem:(_key:string,value:string)=>{if(fail)throw Error('quota');raw=value}});setActivePinia(createPinia());const store=useTempo();fail=true;expect(()=>store.addStudent(input,'new')).toThrow();expect(store.data.students).toHaveLength(5);fail=false;store.addStudent(input,'new');store.editStudent('new',{...input,name:'更新'});expect(createLocalRepository().load().students.at(-1)!.name).toBe('更新')});
});
describe('学员课程与统计',()=>{
 function fixture(){const d=seed(),template=d.bookings[0]!;d.bookings=[
  {...template,id:'done',status:'completed' as const,start_at:new Date('2026-11-10T09:00:00').toISOString(),end_at:new Date('2026-11-10T10:00:00').toISOString()},
  {...template,id:'future',start_at:new Date('2026-11-12T09:00:00').toISOString(),end_at:new Date('2026-11-12T10:00:00').toISOString()},
  {...template,id:'cancel',status:'cancelled' as const,start_at:new Date('2026-11-13T09:00:00').toISOString(),end_at:new Date('2026-11-13T10:00:00').toISOString()},
  {...template,id:'pending',status:'pending' as const,start_at:new Date('2026-11-14T09:00:00').toISOString(),end_at:new Date('2026-11-14T10:00:00').toISOString()},
 ];return d}
 const filters={status:'all' as const,type:'',from:'',to:''};
 it('已完成次数、最近训练及有效预约独立于列表过滤',()=>{const d=fixture(),id=d.students[0]!.id;expect(studentSummary(d,id,now)).toEqual({completed:1,active:2,last:d.bookings[0]!.start_at});expect(studentSummary(d,d.students[1]!.id,now)).toEqual({completed:0,active:0,last:null})});
 it('未来确认、待确认、取消分别可查，所有记录不隐去过期未完成',()=>{const d=fixture(),id=d.students[0]!.id;expect(filterStudentCourses(d,id,{...filters,status:'upcoming'},now).map(b=>b.id)).toEqual(['future']);expect(filterStudentCourses(d,id,{...filters,status:'pending'},now).map(b=>b.id)).toEqual(['pending']);expect(filterStudentCourses(d,id,{...filters,status:'cancelled'},now).map(b=>b.id)).toEqual(['cancel']);expect(filterStudentCourses(d,id,filters,now)).toHaveLength(4)});
 it('日期含两端，类型过滤与状态叠加，逆序范围不展示记录',()=>{const d=fixture(),id=d.students[0]!.id;expect(filterStudentCourses(d,id,{...filters,from:'2026-11-10',to:'2026-11-10'},now).map(b=>b.id)).toEqual(['done']);expect(filterStudentCourses(d,id,{...filters,type:d.types[1]!.id},now)).toEqual([]);expect(filterStudentCourses(d,id,{...filters,from:'2026-11-14',to:'2026-11-10'},now)).toEqual([])});
 it('当前教练查询不能读取其他教练记录',()=>{const d=fixture(),id=d.students[0]!.id;d.bookings[0]!.coach_id='other';expect(filterStudentCourses(d,id,filters,now)).toHaveLength(3);d.students[0]!.coach_id='other';expect(filterStudentCourses(d,id,filters,now)).toEqual([])});
});
