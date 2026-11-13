import {test,expect} from '@playwright/test';
test('时间设置返回来源并保护未保存修改',async({page})=>{
 await page.goto('/#/my');
 await page.getByRole('link',{name:'可预约时间',exact:true}).click();
 await page.screenshot({path:`test-results/navigation-${test.info().project.name}.png`});
 await page.getByRole('button',{name:'返回上一页'}).click();
 await expect(page).toHaveURL(/#\/my$/);
 await page.getByRole('link',{name:'可预约时间',exact:true}).click();
 await page.getByLabel('课程间隔',{exact:true}).selectOption('15');
 page.once('dialog',dialog=>dialog.dismiss());
 await page.getByRole('button',{name:'返回上一页'}).click();
 await expect(page).toHaveURL(/#\/availability$/);
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'返回上一页'}).click();
 await expect(page).toHaveURL(/#\/my$/);
});
