import {test,expect} from '@playwright/test';
test('单层课表滚动、周摘要、导航与来源返回',async({page})=>{
 await page.goto('/');
 if(test.info().project.name!=='desktop'){
  await expect(page.locator('.board-scroll')).toHaveCSS('overflow','visible');
  await expect(page.locator('.board-scroll')).toHaveCSS('max-height','none');
  await page.getByRole('button',{name:'周',exact:true}).click();
  await expect(page.locator('.week-board')).toBeVisible();
  await page.locator('.board-head button').first().click();
 }
 await page.getByLabel('选择日期').fill('2026-12-02');
 await page.getByRole('link',{name:'学员',exact:true}).click();
 await page.getByLabel('搜索学员').fill('林晓');
 await page.locator('.student-row').click();
 if(test.info().project.name!=='desktop')await expect(page.locator('.sidebar')).toBeHidden();
 const profile=page.url();
 await page.getByRole('link',{name:'为 TA 排课',exact:false}).click();
 await page.getByRole('button',{name:'返回',exact:true}).click();
 await expect(page).toHaveURL(profile);
 await page.goBack();
 await expect(page.getByLabel('搜索学员')).toHaveValue('林晓');
 await page.getByRole('link',{name:'课表',exact:true}).click();
 await expect(page.getByLabel('选择日期')).toHaveValue('2026-12-02');
 await page.getByRole('link',{name:'我的',exact:true}).click();
 await page.getByRole('link',{name:'可预约时间',exact:true}).click();
 await expect(page.getByLabel('课程间隔',{exact:true})).toBeVisible();
});
