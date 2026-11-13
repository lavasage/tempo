export type Status='pending'|'confirmed'|'completed'|'cancelled';
export interface Coach {id:string;name:string;email:string;created_at:string}
export interface Student {id:string;coach_id:string;name:string;phone:string;notes:string;goal?:string;created_at:string;preferences:string[]}
export interface CourseType {id:string;name:string;default_duration:number;color:string}
/** package_id 为空表示这节「不计套餐」（体验课、单次课或未关联的历史课程）。 */
export interface Booking {id:string;coach_id:string;student_id:string;course_type_id:string;start_at:string;end_at:string;status:Status;notes:string;package_id:string|null;created_at:string;updated_at:string}
/** 一次购买独立建档；套餐本身不改总节数，续购是新的记录。 */
export interface LessonPackage {id:string;coach_id:string;student_id:string;course_type_id:string|null;name:string;total_sessions:number;initial_used:number;purchased_on:string;expires_on:string|null;notes:string;created_at:string}
export type LessonTxKind='purchase'|'consume'|'refund'|'adjust';
/** 余额唯一来源：套餐全部流水求和。purchase 为正，consume 为负，refund 为正，adjust 可正可负。 */
export interface LessonTransaction {id:string;coach_id:string;package_id:string;booking_id:string|null;kind:LessonTxKind;quantity:number;reason:string;created_at:string}
/** 一条训练记录：rating / actual_minutes 都可为空。空评分不等于零分，空时长不计入已记录训练时长。 */
export interface TrainingReview {id:string;booking_id:string;coach_id:string;rating:number|null;effort:number|null;actual_minutes:number|null;notes:string;created_at:string;updated_at:string}
export interface BookingEvent {id:string;booking_id:string;coach_id:string;kind:"created"|"edited"|"status";before:Booking|null;after:Booking;created_at:string}
export interface WeeklyWindow {id:string;days:number[];start:string;end:string}
export interface BlockedTime {id:string;start_at:string;end_at:string;label:string}
export interface AvailabilitySettings {business:WeeklyWindow[];work:WeeklyWindow[];breaks:WeeklyWindow[];buffer_minutes:number;blocked:BlockedTime[]}
export interface Database {coach:Coach;students:Student[];types:CourseType[];bookings:Booking[];reviews:TrainingReview[];booking_events:BookingEvent[];packages:LessonPackage[];lesson_tx:LessonTransaction[];availability:AvailabilitySettings}
