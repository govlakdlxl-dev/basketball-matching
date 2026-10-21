import {test,expect} from '@playwright/test';
import {createDatabaseFixture} from '../integration/fixtures/database';
test('4대4 변경 안내 뒤 불참을 고르면 원래 신청을 취소로 표시한다',async({page})=>{
 const db=await createDatabaseFixture();
 try {
  await db.sql`update public.teams set status='approved' where id=${db.teamId}`;
  const starts=new Date(Date.now()+86400000).toISOString(),ends=new Date(Date.now()+93600000).toISOString();
  const match=await (await db.request('captain','/api/matches','POST',{teamId:db.teamId,facilityId:'b0000000-0000-4000-a000-000000000001',startsAt:starts,endsAt:ends,playersPerTeam:5,teamCount:2,existingPlanned:9,guestSlots:{guard:1,forward:0,center:0},baseFeeKrw:0,policy:{version:'test-A-v1'},meetingPoint:'입구',rotationDescription:'5대5',guestComposition:'개인 게스트',captainCoordination:'주장 조율',reservationNote:'로컬 검증',expectedPlayingMinutes:null,requestId:crypto.randomUUID()})).json() as {id:string};
  const app=await (await db.request('memberA',`/api/matches/${match.id}/applications`,'POST',{position:'guard',requestId:crypto.randomUUID()})).json() as {id:string};
  await db.request('captain',`/api/applications/${app.id}/accept`,'POST',{requestId:crypto.randomUUID()});
  await db.request('captain',`/api/matches/${match.id}/format-notices`,'POST',{playersPerTeam:4,reason:'인원에 맞춰 4대4로 변경',requestId:crypto.randomUUID()});
  await page.goto('/#/hosting');await page.getByLabel('테스트 이메일').fill(db.logins.memberA.email);await page.getByLabel('테스트 비밀번호').fill(db.logins.memberA.password);await page.getByRole('button',{name:'테스트 계정 로그인',exact:true}).click();
  await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();await page.goto('/#/applications');
  await expect(page.getByText('주최자 변경 · 5대5 → 4대4',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'변경으로 불참 · 전액 환불 대상',exact:true}).click();
  await expect(page.getByText('취소',{exact:true})).toBeVisible();
  expect((await db.sql`select cause from public.cancellation_receipts where application_id=${app.id}`)[0]!.cause).toBe('format_change_declined');
 } finally {await db.reset();}
});
