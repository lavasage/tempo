import type {AvailabilitySettings, Booking, CourseType, Database, LessonPackage, Status, Student, TrainingReview} from '../../types';
import type {ApiClient} from './client';
import {availabilityPayload, decodeSnapshot, packagePayload, reviewRow, studentRow, typeRow, type SnapshotJson} from './mapping';

/**
 * 远端仓库：所有写操作走 RPC/PostgREST，错误由数据库约束产生。
 * 本地缓存仍是同步数据源；本层由同步队列调用，不直接阻塞界面。
 */
export function createRemoteRepository(client: ApiClient) {
  return {
    async load(): Promise<Database> {
      return decodeSnapshot(await client.rpc<SnapshotJson>('snapshot'));
    },
    async saveStudent(student: Student) {
      await client.upsert('students', [studentRow(student)], 'id');
    },
    async saveType(type: CourseType, coachId: string) {
      await client.upsert('course_types', [typeRow(type, coachId)], 'id');
    },
    async createBooking(booking: Booking) {
      // 用课程 id 当幂等键：网络重试不会产生第二节课。
      await client.rpc('booking_create', {
        p_student: booking.student_id,
        p_type: booking.course_type_id,
        p_start: booking.start_at,
        p_end: booking.end_at,
        p_notes: booking.notes,
        p_request: booking.id,
        p_status: booking.status,
        p_package: booking.package_id
      });
    },
    async updateBooking(booking: Booking) {
      await client.rpc('booking_update', {
        p_id: booking.id,
        p_start: booking.start_at,
        p_end: booking.end_at,
        p_type: booking.course_type_id,
        p_notes: booking.notes,
        p_package: booking.package_id,
        // 显式声明「套餐归属以这次提交为准」，否则服务端会保留原值。
        p_package_set: true
      });
    },
    async setStatus(id: string, status: Status) {
      await client.rpc('booking_set_status', {p_id: id, p_status: status});
    },
    async saveReview(review: TrainingReview) {
      await client.upsert('training_reviews', [reviewRow(review)], 'id');
    },
    async saveAvailability(settings: AvailabilitySettings) {
      await client.rpc('save_availability', availabilityPayload(settings));
    },
    /** 套餐 id 由客户端生成：重放只会在服务端命中同一份记录，不会建成两份。 */
    async savePackage(pkg: LessonPackage) {
      await client.rpc('package_save', packagePayload(pkg));
    },
    async revertLesson(bookingId: string, reason: string) {
      await client.rpc('lesson_revert', {p_booking: bookingId, p_reason: reason});
    }
  };
}

export type RemoteRepository = ReturnType<typeof createRemoteRepository>;
