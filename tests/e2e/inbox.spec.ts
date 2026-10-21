import {test,expect} from '@playwright/test';
import {createDatabaseFixture} from '../integration/fixtures/database';
import {acceptedPayment} from '../integration/fixtures/payments';
import {createDatabase} from '../../apps/server/src/infra/database';
import {createNotificationRepository} from '../../apps/server/src/features/notifications/repository';
test('알림함은 본인 기록과 읽음을 공유하고 HTML처럼 생긴 안내도 문자로 표시한다',async({page})=>{
 const db=await createDatabaseFixture();try{
  await db.sql`update public.teams set status='approved' where id=${db.teamId}`;const s=await acceptedPayment(db,10000,false),text='<img src=x onerror=alert(1)> 팀 안내';
  await createNotificationRepository(createDatabase(db.env)).persistNotificationPlan(null,{notices:[{logicalKey:`application:${s.a.id}:payment`,recipientId:db.memberA.userId,matchId:s.m.id,applicationId:s.a.id,kind:'application.accepted',text,isActionable:true,targetVersion:null}],windows:[],deliveries:[]});
  await page.goto('/#/hosting');await page.getByLabel('테스트 이메일').fill(db.logins.memberA.email);await page.getByLabel('테스트 비밀번호').fill(db.logins.memberA.password);await page.getByRole('button',{name:'테스트 계정 로그인',exact:true}).click();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();await page.goto('/#/notifications');
  await expect(page.getByText(text,{exact:true})).toBeVisible();await expect(page.locator('#content img')).toHaveCount(0);await page.getByRole('button',{name:'읽음으로 표시',exact:true}).click();await expect(page.getByText('읽음',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('읽음',{exact:true})).toBeVisible();
  const notice=(await db.sql`select id from public.notifications where match_id=${s.m.id}`)[0]!;expect((await db.request('memberB',`/api/notifications/${notice.id}`)).status).toBe(403);
 }finally{await db.reset();}
});
