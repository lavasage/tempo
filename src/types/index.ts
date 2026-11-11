export type Status='pending'|'confirmed'|'completed'|'cancelled';
export interface Coach {id:string;name:string;email:string;created_at:string}
export interface Student {id:string;coach_id:string;name:string;phone:string;notes:string;goal?:string;created_at:string;preferences:string[]}
export interface CourseType {id:string;name:string;default_duration:number;color:string}
export interface Booking {id:string;coach_id:string;student_id:string;course_type_id:string;start_at:string;end_at:string;status:Status;notes:string;created_at:string;updated_at:string}
export interface TrainingReview {id:string;booking_id:string;coach_id:string;rating:number;effort:number|null;actual_minutes:number;notes:string;created_at:string;updated_at:string}
export interface BookingEvent {id:string;booking_id:string;coach_id:string;kind:"created"|"edited"|"status";before:Booking|null;after:Booking;created_at:string}
export interface WeeklyWindow {id:string;days:number[];start:string;end:string}
export interface BlockedTime {id:string;start_at:string;end_at:string;label:string}
export interface AvailabilitySettings {business:WeeklyWindow[];work:WeeklyWindow[];breaks:WeeklyWindow[];buffer_minutes:number;blocked:BlockedTime[]}
export interface Database {coach:Coach;students:Student[];types:CourseType[];bookings:Booking[];reviews:TrainingReview[];booking_events:BookingEvent[];availability:AvailabilitySettings}
