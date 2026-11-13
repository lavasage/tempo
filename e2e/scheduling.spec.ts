import {test,expect} from '@playwright/test';
test('日期切换、创建、修改、冲突拦截、取消、关联与历史',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-11T20:00:00+08:00'));
 await page.goto('/');
 await page.getByLabel('选择日期').fill('2026-11-12');
 await expect(page.locator('.calendar-caption')).toContainText('12');
 await page.getByRole('button',{name:'周',exact:true}).click();
 await expect(page.locator('.timeline-column')).toHaveCount(7);
 await page.getByRole('button',{name:'日',exact:true}).click();
 await page.getByRole('button',{name:'08:00 排课',exact:true}).click();
 await page.getByLabel('备注').fill('M1测试课程');
 await page.getByRole('button',{name:'确认排课',exact:true}).click();
 await expect(page.getByLabel('选择日期')).toHaveValue('2026-11-12');
 await expect(page.locator('.booking')).toHaveCount(1);
 await page.locator('.booking').click();
 const url=page.url();await page.reload();await expect(page.getByLabel('备注')).toHaveValue('M1测试课程');
 await page.getByLabel('开始时间').fill('10:00');
 await page.getByRole('button',{name:'保存修改'}).click();
 await page.goto('/#/'); await page.getByRole('button',{name:'排课',exact:true}).click();
 await page.getByLabel('上课日期').fill('2026-11-12');
 await page.getByLabel('开始时间').fill('10:30');
 await expect(page.getByRole('alert')).toContainText('重叠');
 await expect(page.getByRole('button',{name:'确认排课',exact:true})).toBeDisabled();
 /* 未保存草稿离开会弹确认；视图切换与取消课程都统一接受 */
 page.on('dialog',d=>d.accept());
 await page.goto(url);
 await page.getByRole('button',{name:'取消预约'}).click();
 await page.locator('.cancelled-list summary').click();
 await expect(page.locator('.booking')).toContainText('已取消');
 await page.locator('.booking').click();
 await page.getByText('课程变更记录', {exact:true}).click();
 /* 抽屉叠加在课表之上，事件日志要定位到抽屉内的 details */
 await expect(page.locator('.event-log')).toContainText('创建课程');
 await expect(page.locator('.event-log')).toContainText('修改课程');
 await expect(page.locator('.event-log')).toContainText('状态变更');
 /* 抽屉是模态浮层，先关闭才能回到侧边导航 */
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('link',{name:'学员',exact:true}).click();
 await page.getByLabel('搜索学员').fill('林晓');await page.locator('.student-row').click();
 await expect(page.locator('.history').filter({hasText:'已取消'})).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


