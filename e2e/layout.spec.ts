import {test,expect} from '@playwright/test';
test('主页面与编辑页布局无溢出',async({page})=>{
 for(const [name,path] of [['calendar','/'],['students','/students'],['my','/my'],['student-editor','/students/new'],['booking','/create']]){
  await page.goto('/#'+path);
  await expect(page.locator('h1').last()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(name==='students'&&(page.viewportSize()?.width??0)<=900)await expect(page.locator('.student-unselected')).toBeHidden();
  await page.screenshot({path:`test-results/layout-${name}-${test.info().project.name}.png`,animations:'disabled'});
 }
});
