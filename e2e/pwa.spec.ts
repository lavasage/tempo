import {expect, test} from '@playwright/test';

/** M5：安装入口、离线提示与键盘可达性。 */
test.describe('PWA 与无障碍', () => {
  test('页面声明了可安装清单与图标', async ({page}) => {
    await page.goto('/');
    const href = await page.locator('link[rel=manifest]').getAttribute('href');
    expect(href).toBe('/manifest.webmanifest');
    const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
    expect(manifest.name).toContain('Tempo');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some((i: {purpose?: string}) => i.purpose === 'maskable')).toBe(true);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });

  test('键盘第一个 Tab 落在跳转链接，回车把焦点交给正文', async ({page}) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    expect(page.url()).not.toContain('#main');   // 不污染 hash 路由
  });

  test('断网时显示离线提示，恢复后自动消失', async ({page, context}) => {
    await page.goto('/');
    await expect(page.locator('.banner-offline')).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.locator('.banner-offline')).toBeVisible();
    await expect(page.locator('.banner-offline')).toContainText('已离线');
    await context.setOffline(false);
    await expect(page.locator('.banner-offline')).toHaveCount(0);
  });

  test('捕获到安装能力时显示安装卡片', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('.install-card')).toHaveCount(0);
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt') as Event & {prompt?: () => Promise<void>; userChoice?: Promise<{outcome: string}>};
      event.prompt = async () => undefined;
      event.userChoice = Promise.resolve({outcome: 'dismissed'});
      window.dispatchEvent(event);
    });
    await expect(page.locator('.install-card')).toBeVisible();
    await expect(page.locator('.install-card')).toContainText('装到桌面');
  });

  test('主导航有可读名称，正文有唯一主区域', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('nav[aria-label="主导航"]')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('main#main')).toHaveCount(1);
  });
});
