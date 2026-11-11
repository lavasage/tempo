import {test,expect} from '@playwright/test';
test('完成课程、评分、修改、刷新与学员统计',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-11T20:00:00+08:00'));
 await page.goto('/');
 await page.locator('.booking').first().click();
 await page.getByRole('button',{name:'标记已完成'}).click();
 await expect(page.getByRole('heading',{name:'课后反馈'})).toBeVisible();
 await page.getByRole('radio',{name:'4 表现良好'}).check();
 await page.getByLabel('实际训练时长（分钟）').fill('55');
 await page.getByLabel('学员反馈用力程度').selectOption('7');
 await page.getByRole('button',{name:'保存反馈',exact:true}).click();
 /* 反馈面板内的状态提示（页面级通知条也是 status，这里要定位到面板） */
 await expect(page.locator('.review-section').getByRole('status')).toContainText('反馈已保存');
 await page.reload();
 await expect(page.getByRole('radio',{name:'4 表现良好'})).toBeChecked();
 await expect(page.getByLabel('实际训练时长（分钟）')).toHaveValue('55');
 await page.getByRole('radio',{name:'5 表现出色'}).check();
 await page.getByRole('button',{name:'更新反馈'}).click();
 await page.screenshot({path:`test-results/review-${test.info().project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:'返回课表',exact:false}).click();
 await page.locator('.calendar-review > summary').click();
 await expect(page.locator('.training-stats')).toContainText('5.0');
 await expect(page.locator('.training-stats')).toContainText('已评 1 / 1');
 await page.getByRole('link',{name:'学员',exact:true}).click();
 await page.locator('.student-row').first().click();
 await page.locator('.student-review > summary').click();
 await expect(page.locator('.training-stats')).toContainText('55');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/student-${test.info().project.name}.png`,fullPage:true});
});


