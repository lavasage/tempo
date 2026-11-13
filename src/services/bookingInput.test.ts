import {it,expect} from 'vitest';
import {bookingStart} from './bookingInput';
import {changeStatus} from './booking';
import type {Booking} from '../types';
it('空日期、空时间、非法日期和时长不会进入ISO序列化',()=>{
 for(const [date,time,duration] of [['','09:00',60],['2026-11-13','',60],['2026-02-30','09:00',60],['2026-11-13','25:00',60],['2026-11-13','09:00',NaN]] as const)expect(()=>bookingStart(date,time,duration)).toThrow();
 expect(bookingStart('2026-11-13','09:00',60).getHours()).toBe(9);
});
it('开始前拒绝完成，开始边界允许手动完成',()=>{
 const b:Booking={id:'a',coach_id:'c',student_id:'s',course_type_id:'t',status:'confirmed',start_at:'2026-11-13T01:00:00Z',end_at:'2026-11-13T02:00:00Z',notes:'',package_id:null,created_at:'',updated_at:''};
 expect(()=>changeStatus(b,'completed',new Date('2026-11-13T00:59:59Z'))).toThrow('尚未开始');
 expect(changeStatus(b,'completed',new Date(b.start_at)).status).toBe('completed');
});
