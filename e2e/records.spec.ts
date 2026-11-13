import {test,expect} from '@playwright/test';
import {seed} from '../src/mock/seed';
import type {Database,Status} from '../src/types';

const NOW='2026-11-11T20:00:00+08:00';

function base(){const d=seed();d.bookings=[];d.reviews=[];return d}
function add(d:Database,key:string,student:number,start:string,status:Status,minutes=60){
  const from=Date.parse(start);
  d.bookings.push({id:`b-${key}`,coach_id:d.coach.id,student_id:d.students[student]!.id,course_type_id:d.types[student%3]!.id,start_at:new Date(from).toISOString(),end_at:new Date(from+minutes*60000).toISOString(),status,notes:'',package_id:null,created_at:'',updated_at:''});
}
function log(d:Database,key:string,rating:number|null,effort:number|null,minutes:number|null){
  d.reviews.push({id:`r-${key}`,booking_id:`b-${key}`,coach_id:d.coach.id,rating,effort,actual_minutes:minutes,notes:'',created_at:'',updated_at:''});
}

/** 11 月 11/10/09 三节 + 9 月 1 日一节；11-08 有取消与未完成各一节。 */
function mixed(){
  const d=base();
  add(d,'a',0,'2026-11-11T09:00:00+08:00','completed');          // 有评分无用力
  log(d,'a',4,null,55);
  add(d,'b',1,'2026-11-10T10:00:00+08:00','completed');          // 有日志未评分
  log(d,'b',null,null,50);
  add(d,'c',2,'2026-11-09T14:00:00+08:00','completed');          // 完成未记录
  add(d,'d',3,'2026-09-01T09:00:00+08:00','completed');          // 90 天可见
  log(d,'d',5,8,60);
  add(d,'x',2,'2026-11-08T09:00:00+08:00','cancelled');
  add(d,'y',4,'2026-11-08T15:00:00+08:00','pending');
  return d;
}

async function open(page:import('@playwright/test').Page,data:Database,hash='#/my'){
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript((db)=>localStorage.setItem('tempo.v1',JSON.stringify(db)),data);
  await page.goto('/'+hash);
}

test('没有已完成课程：只留一句状态和课表入口',async({page})=>{
  await open(page,base());
  const section=page.locator('.teaching-records');
  await expect(section).toContainText('还没有已完成课程');
  await expect(section.getByTestId('records-empty')).toBeVisible();
  await expect(section.locator('.records-facts')).toHaveCount(0);
  await expect(section.locator('.records-list')).toHaveCount(0);
  const link=section.getByRole('link',{name:/查看课表/});
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href','#/');
  await expect(section.locator('select')).toHaveValue('30');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/records-empty-${test.info().project.name}.png`,fullPage:true});
});

test('混合记录：完成数、排课时长、三种状态与最近三条',async({page})=>{
  await open(page,mixed());
  const section=page.locator('.teaching-records');
  await expect(section.locator('.records-facts')).toContainText('完成 3 节');
  await expect(section.locator('.records-facts')).toContainText('排课时长 3 小时');
  await expect(section.locator('.records-meta')).toContainText('已记录训练时长 1 小时 45 分（2 节有记录）');
  await expect(section.locator('.records-meta')).toContainText('有评分 1 节');
  await expect(section.locator('.records-meta')).not.toContainText('用力反馈');

  const rows=section.locator('.records-list > li .record-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('林晓 · 力量训练');
  await expect(rows.nth(0)).toContainText('训练 55 分钟 · 表现 4/5');
  await expect(rows.nth(1)).toContainText('陈宇 · 功能训练');
  await expect(rows.nth(1)).toContainText('训练 50 分钟 · 未评分');
  await expect(rows.nth(2)).toContainText('未记录');

  // 每行都能进入对应课程
  await expect(rows.nth(0)).toHaveAttribute('href','#/booking/b-a');

  // 待补反馈：一个入口，切到待补列表，与最近授课不重复
  const toggle=section.getByTestId('records-pending-toggle');
  await expect(toggle).toContainText('待补反馈');
  await expect(toggle.locator('.pending-count')).toHaveText('2');
  await toggle.click();
  await expect(section.locator('.records-subhead')).toHaveText('待补反馈');
  const pendingRows=section.getByTestId('records-list').locator('.record-row');
  await expect(pendingRows).toHaveCount(2);
  await expect(pendingRows.nth(0)).toContainText('未评分');
  await expect(pendingRows.nth(1)).toContainText('未记录');
  await expect(section.locator('.records-all')).toHaveCount(0);
  await toggle.click();
  await expect(section.locator('.records-subhead')).toHaveText('最近授课');
  await expect(pendingRows).toHaveCount(3);

  // 只有 3 条时不显示无意义的「全部」入口
  await expect(section.locator('.records-all')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  // 触控目标不小于 44px
  const heights=await section.locator('.record-row').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:`test-results/records-filled-${test.info().project.name}.png`,fullPage:true});
});

test('切换 90 天后数字、待补与列表同口径',async({page})=>{
  await open(page,mixed());
  const section=page.locator('.teaching-records');
  await section.locator('select').selectOption('90');
  await expect(section.locator('.records-facts')).toContainText('完成 4 节');
  await expect(section.locator('.records-meta')).toContainText('已记录训练时长 2 小时 45 分（3 节有记录）');
  await expect(section.locator('.records-meta')).toContainText('有评分 2 节');
  await expect(section.locator('.records-meta')).toContainText('用力反馈 1 条');
  await expect(section.locator('.pending-count')).toHaveText('2');

  const all=section.locator('.records-all');
  await expect(all).toContainText('全部授课记录');
  await all.locator('summary').click();
  await expect(all.locator('.record-row')).toHaveCount(1);
  await expect(all.locator('.record-row').first()).toBeVisible();
  await expect(all).toContainText('赵一鸣 · 力量训练');
  await expect(all.locator('.record-row')).toContainText('训练 60 分钟 · 表现 5/5 · 用力 8/10');
});

test('范围内没有课程与完全没有数据区分开',async({page})=>{
  const d=base();
  add(d,'old',0,'2026-06-01T09:00:00+08:00','completed');
  await open(page,d);
  const section=page.locator('.teaching-records');
  await expect(section.getByTestId('records-scope-empty')).toContainText('这段时间暂无已完成课程');
  await expect(section.getByTestId('records-empty')).toHaveCount(0);
  await expect(section.locator('.records-facts')).toHaveCount(0);

  await section.getByRole('button',{name:/查看全部记录/}).click();
  await expect(section.locator('.records-facts')).toContainText('完成 1 节');
  await expect(section.locator('select')).toHaveValue('0');
});

test('学员详情保留个人训练表现，未评分不计零分',async({page})=>{
  await open(page,mixed(),'#/students');
  await page.locator('.student-row',{hasText:'陈宇'}).first().click();
  await page.locator('.student-review > summary').click();
  const stats=page.locator('.training-stats');
  await expect(stats).toContainText('训练表现');
  await expect(stats.locator('.stats-facts')).toContainText('完成 1 节');
  await expect(stats.locator('.stats-facts')).toContainText('平均表现 —');
  await expect(stats.locator('.stats-meta')).toContainText('已记录训练时长 50 分钟（1 节）');
  await expect(stats.locator('.records-group > summary')).toContainText('评分与训练记录 · 1 节');
  await expect(stats.locator('.record-row')).toContainText('训练 50 分钟 · 未评分');
  await page.screenshot({path:`test-results/student-performance-${test.info().project.name}.png`,fullPage:true});
});
