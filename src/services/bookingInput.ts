/** 校验本地日期时间，先于ISO序列化执行，拒绝空值和日期自动进位。 */
export function bookingStart(date:string,time:string,duration:number):Date{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('请选择上课日期');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('请选择开始时间');
 if(!Number.isFinite(duration)||!Number.isInteger(duration)||duration<=0||duration>1440)throw Error('请选择有效课程时长');
 const value=new Date(date+'T'+time);
 const [year,month,day]=date.split('-').map(Number);
 if(!Number.isFinite(value.getTime())||value.getFullYear()!==year||value.getMonth()+1!==month||value.getDate()!==day||value.getHours()!==Number(time.slice(0,2))||value.getMinutes()!==Number(time.slice(3)))throw Error('请选择有效的日期和时间');
 return value;
}
