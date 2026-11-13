import {test,expect} from '@playwright/test';
test('周时间网格与教练工作页',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-13T10:30:00+08:00'));
 await page.goto('/');await page.getByRole('button',{name:'周',exact:true}).click();
 await expect(page.locator('.week-board')).toBeVisible();
 await expect(page.locator('.timeline-column')).toHaveCount(7);
 const columns=await page.locator('.board-head button').evaluateAll(nodes=>nodes.map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})));
 expect(columns.every(c=>c.left>=0&&c.right<=(page.viewportSize()?.width??0))).toBe(true);
 await expect(page.locator('.calendar-review')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/athletic-week-${test.info().project.name}.png`});
 await page.getByRole('link',{name:'我的',exact:true}).click();
 await expect(page.getByRole('heading',{name:'授课记录'})).toBeVisible();
 await expect(page.getByRole('link',{name:'可预约时间',exact:true})).toBeVisible();
 await page.screenshot({path:`test-results/athletic-my-${test.info().project.name}.png`});
});
