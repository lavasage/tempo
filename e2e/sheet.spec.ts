import {test,expect} from '@playwright/test';
test('待办弹层关闭、系统返回和焦点恢复',async({page})=>{
 await page.goto('/');
 const trigger=page.getByRole('button',{name:/^待处理/});
 await trigger.click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.goBack();await expect(page.getByRole('dialog')).toBeHidden();
 await expect(trigger).toBeFocused();
 await trigger.click();await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toBeHidden();
 await trigger.click();await page.getByRole('button',{name:'关闭面板'}).click();
 await expect(page.getByRole('dialog')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await trigger.click();await page.screenshot({animations:'disabled',path:`test-results/sheet-${test.info().project.name}.png`});
});

