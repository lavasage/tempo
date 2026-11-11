import type {Booking} from '../types';
import {dateKey,shift} from '../composables/date';
export function validDay(value:unknown):string {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return dateKey();const d=new Date(value+'T12:00:00');return Number.isFinite(d.getTime())&&dateKey(d)===value?value:dateKey()}
export function weekDays(day:string){const offset=(new Date(day+'T12:00:00').getDay()+6)%7;return Array.from({length:7},(_,i)=>shift(day,i-offset))}
export function monthDays(day:string){const start=weekDays(day.slice(0,7)+'-01')[0]!;return Array.from({length:42},(_,i)=>shift(start,i))}
export function moveMonth(day:string,n:number){const d=new Date(day+'T12:00:00');d.setDate(1);d.setMonth(d.getMonth()+n);return dateKey(d)}
export function bookingLanes(bookings:Booking[]){
 const sorted=[...bookings].sort((a,b)=>Date.parse(a.start_at)-Date.parse(b.start_at));const groups:Booking[][]=[];let group:Booking[]=[],end=0;
 for(const b of sorted){if(group.length&&Date.parse(b.start_at)>=end){groups.push(group);group=[];end=0}group.push(b);end=Math.max(end,Date.parse(b.end_at))}if(group.length)groups.push(group);
 return groups.flatMap(items=>{const lanes:number[]=[];const positions=items.map(booking=>{let lane=lanes.findIndex(end=>end<=Date.parse(booking.start_at));if(lane===-1)lane=lanes.length;lanes[lane]=Date.parse(booking.end_at);return {booking,lane}});return positions.map(p=>({...p,total:lanes.length}))});
}
