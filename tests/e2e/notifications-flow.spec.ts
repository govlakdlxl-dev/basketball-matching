import {test,expect} from '@playwright/test';
import {createDatabaseFixture} from '../integration/fixtures/database';
import {acceptedPayment} from '../integration/fixtures/payments';
import {createDatabase} from '../../apps/server/src/infra/database';
import {createNotificationTick} from '../../apps/server/src/jobs/notifications';
import {DisabledAlimtalkAdapter} from '../../apps/server/src/features/notifications/ports/disabled-alimtalk';
test('정기 작업의 수락 안내를 확인하고 결제 완료 뒤 알림 상세에서 현재 참여 상태로 이동한다',async({page})=>{
 const db=await createDatabaseFixture();try{
  await db.sql`update public.teams set status='approved' where id=${db.teamId}`;const s=await acceptedPayment(db,10000,false),disabled=new DisabledAlimtalkAdapter(),tick=createNotificationTick(createDatabase(db.env),disabled,disabled);
  await tick.runNotificationTick('2026-10-20T10:00:00Z',crypto.randomUUID());
  await page.goto('/#/hosting');await page.getByLabel('테스트 이메일').fill(db.logins.memberA.email);await page.getByLabel('테스트 비밀번호').fill(db.logins.memberA.password);await page.getByRole('button',{name:'테스트 계정 로그인',exact:true}).click();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();await page.goto('/#/notifications');await expect(page.getByRole('heading',{name:'신청 수락',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'참여 상태 확인',exact:true}).click();await page.getByRole('button',{name:'테스트 결제하기',exact:true}).click();await page.getByRole('button',{name:'로컬 테스트 승인',exact:true}).click();await expect(page.getByText('결제 승인이 확인됐어요.',{exact:true})).toBeVisible();
  await db.setLocalDatabaseTime('2026-10-20T10:05:00Z');await tick.runNotificationTick('2026-10-20T10:05:00Z',crypto.randomUUID());await page.goto('/#/notifications');await expect(page.getByRole('heading',{name:'참가 확정',exact:true})).toBeVisible();
  expect((await db.sql`select count(*)::int n from public.notification_job_items i join public.notifications n on n.id=i.notification_id where n.application_id=${s.a.id} and i.milestone like 'repeat:%'`)[0]?.n).toBe(0);
 }finally{await db.reset();}
});
