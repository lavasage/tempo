import {test, expect} from '@playwright/test';

type P = import('@playwright/test').Page;

// 抽屉改过状态后表单处于「未保存」状态，离开会弹出确认框；用例里统一放行。
test.beforeEach(async ({page}) => {
  page.on('dialog', (dialog) => dialog.accept());
});

/** 移动端进入档案后列表会被隐藏，先退回列表再点下一人。 */
async function openStudent(page: P, name: string) {
  await page.goto('/#/students');
  await page.waitForURL(/#\/students$/);
  const back = page.locator('.student-back.mobile');
  if ((await back.count()) && (await back.first().isVisible())) await back.first().click();
  await page.locator('.student-row', {hasText: name}).first().click();
  await expect(page.locator('.profile-header h2')).toHaveText(name);
}

/** 演示数据里林晓有一份「私教 12 节」，期初已用 7 节，今天 09:00 那节已关联套餐。 */
async function openLinxiao(page: P) {
  await openStudent(page, '林晓');
}

test('套餐登记与档案余额展示', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-11-11T10:30:00+08:00'));
  await page.goto('/');
  await openLinxiao(page);

  // 种子套餐：总 12、已上 7、剩余 5；09:00 那节确认预约占用 1 节。
  const first = page.locator('.package-card').first();
  await expect(first).toContainText('私教 12 节');
  await expect(first.getByTestId('package-remaining')).toHaveText('5');
  await expect(first).toContainText('共 12 · 已上 7');
  await expect(first).toContainText('其中已占用 1 节，还可约 4 节');

  // 登记第二份套餐：10 节，期初已用 2 节 → 剩余 8。
  await page.getByRole('button', {name: '登记套餐', exact: true}).click();
  await page.getByLabel('套餐名称').fill('体验课 10 节');
  await page.getByLabel('总节数').fill('10');
  await page.getByLabel('期初已用').fill('2');
  await page.getByRole('button', {name: '登记套餐', exact: true}).last().click();

  await expect(page.locator('.package-card')).toHaveCount(2);
  await expect(page.locator('.package-card').nth(1)).toContainText('体验课 10 节');
  await expect(page.locator('.package-card').nth(1).getByTestId('package-remaining')).toHaveText('8');
});

test('排课关联套餐、完成扣课与撤销冲正', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-11-11T10:30:00+08:00'));
  await page.goto('/');
  await openLinxiao(page);

  // 09:00 那节已关联套餐：打开抽屉能看到扣课提示。
  await page.goto('/');
  await page.locator('.timeline-booking', {hasText: '林晓'}).first().click();
  await expect(page.getByRole('combobox', {name: '套餐课时'})).toHaveValue(/.+/);
  await expect(page.getByTestId('package-hint')).toContainText('完成后扣 1 节');

  await page.getByRole('button', {name: /标记已完成/}).click();
  await expect(page.locator('.lesson-ledger')).toContainText('完成扣课 −1 节');

  // 档案余额随之减少：剩余 4、已上 8、占用 0。
  await openStudent(page, '林晓');
  const card = page.locator('.package-card').first();
  await expect(card.getByTestId('package-remaining')).toHaveText('4');
  await expect(card).toContainText('共 12 · 已上 8');
  await expect(card).toContainText('其中已占用 0 节，还可约 4 节');

  // 撤销误扣：追加冲正流水，余额回到 5。
  await page.goto('/');
  await page.locator('.timeline-booking', {hasText: '林晓'}).first().click();
  await page.locator('.lesson-ledger > summary').click();
  await page.getByRole('button', {name: '撤销扣课'}).click();
  await page.getByLabel('更正原因').fill('误点完成');
  await page.getByRole('button', {name: '确认撤销'}).click();
  await expect(page.locator('.lesson-ledger')).toContainText('撤销扣课 +1 节');
  await expect(page.locator('.lesson-ledger')).toContainText('误点完成');

  await openStudent(page, '林晓');
  await expect(page.locator('.package-card').first().getByTestId('package-remaining')).toHaveText('5');
});

test('没有套餐的学员按不计套餐排课', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-11-11T10:30:00+08:00'));
  await page.goto('/');
  await openLinxiao(page);
  await openStudent(page, '陈宇');
  await expect(page.locator('.package-empty')).toContainText('还没有登记套餐');

  await page.getByRole('link', {name: /为 TA 排课/}).click();
  await expect(page.getByRole('combobox', {name: '学员', exact: true}).locator('option:checked')).toHaveText('陈宇');
  await expect(page.getByRole('combobox', {name: '套餐课时'})).toHaveValue('');
  await page.getByLabel('上课日期').fill('2026-11-11');
  await page.getByLabel('开始时间').fill('15:00');
  await page.getByRole('button', {name: '确认排课'}).click();
  await expect(page.getByRole('button', {name: /^15:00 陈宇/})).toBeVisible();

  await page.goto('/#/students');
  await openStudent(page, '陈宇');
  await expect(page.locator('.package-empty')).toContainText('还没有登记套餐');
});
