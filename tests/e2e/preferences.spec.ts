import { test, expect } from '@playwright/test';
import { createDatabaseFixture } from '../integration/fixtures/database';

test('두 회원의 조건이 분리되고 다시 로그인하면 저장한 조건을 불러온다', async ({ page }) => {
  const db = await createDatabaseFixture();
  async function login(member: 'memberA' | 'memberB') {
    await page.getByLabel('테스트 이메일').fill(db.logins[member].email);
    await page.getByLabel('테스트 비밀번호').fill(db.logins[member].password);
    await page.getByRole('button', { name: '테스트 계정 로그인', exact: true }).click();
    await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  }
  try {
    await page.goto('/#/preferences');
    await login('memberA');
    await page.getByLabel('최대 이동 시간 (분)').fill('45');
    await page.getByRole('button', { name: '내 계정에 조건 저장', exact: true }).click();
    await expect(page.getByText('계정에 조건을 저장했어요.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await login('memberB');
    await expect(page.getByLabel('최대 이동 시간 (분)')).toHaveValue('30');
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await login('memberA');
    await expect(page.getByLabel('최대 이동 시간 (분)')).toHaveValue('45');
  } finally { await db.reset(); }
});
