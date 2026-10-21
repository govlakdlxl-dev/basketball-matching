import {test,expect} from '@playwright/test';
import {createDatabaseFixture} from '../integration/fixtures/database';
import {acceptedPayment} from '../integration/fixtures/payments';
let activeFixture:Awaited<ReturnType<typeof createDatabaseFixture>>|null=null;
test.afterEach(async()=>{await activeFixture?.reset();activeFixture=null;});
test('테스트 결제와 개인 일부 환불 이후 팀 취소의 잔액 환불을 확인한다',async({page})=>{
 const db=await createDatabaseFixture();activeFixture=db;try{
  await db.sql`update public.teams set status='approved' where id=${db.teamId}`;const s=await acceptedPayment(db,10000,false);
  await page.goto('/#/hosting');await page.getByLabel('테스트 이메일').fill(db.logins.memberA.email);await page.getByLabel('테스트 비밀번호').fill(db.logins.memberA.password);await page.getByRole('button',{name:'테스트 계정 로그인',exact:true}).click();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();await page.goto('/#/applications');
  await page.getByRole('button',{name:'테스트 결제하기',exact:true}).click();await expect(page.getByText('실제 출금 없는 로컬 테스트',{exact:true})).toBeVisible();await expect(page.getByText('플랫폼 수수료 0원',{exact:true})).toBeVisible();await page.getByRole('button',{name:'로컬 테스트 승인',exact:true}).click();
  await expect(page.getByText('결제 승인이 확인됐어요.',{exact:true})).toBeVisible();await page.goto('/#/applications');await expect(page.getByText('참가 확정',{exact:true})).toBeVisible();
  await db.setLocalDatabaseTime('2026-10-21T08:00:00Z');await page.getByRole('button',{name:'개인 사정으로 신청 취소',exact:true}).click();await page.getByRole('button',{name:'정책 확인 후 취소 접수',exact:true}).click();await expect(page.getByText('취소',{exact:true})).toBeVisible();await page.getByRole('button',{name:'환불 상태 확인',exact:true}).click();await expect(page.getByText('누적 환불 완료 5,000원',{exact:true})).toBeVisible();
  await db.request('captain',`/api/matches/${s.m.id}/cancel`,'POST',{requestId:crypto.randomUUID()});await page.reload();await page.getByRole('button',{name:'환불 상태 확인',exact:true}).click();await expect(page.getByText('누적 환불 완료 10,000원',{exact:true})).toBeVisible();
  expect((await db.sql`select sum(refunded_krw)::int n from public.test_ledger_entries where order_id=${s.order!.id} and kind='refund'`)[0]?.n).toBe(10000);
 }finally{await db.reset();}
});
test('방식 변경 대상은 개인 일부 환불 뒤에도 변경 불참으로 잔액을 환불받는다',async({page})=>{
 const db=await createDatabaseFixture();activeFixture=db;try{
  await db.sql`update public.teams set status='approved' where id=${db.teamId}`;const s=await acceptedPayment(db,10000,false);
  await page.goto('/#/hosting');await page.getByLabel('테스트 이메일').fill(db.logins.memberA.email);await page.getByLabel('테스트 비밀번호').fill(db.logins.memberA.password);await page.getByRole('button',{name:'테스트 계정 로그인',exact:true}).click();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();await page.goto('/#/applications');
  await page.getByRole('button',{name:'테스트 결제하기',exact:true}).click();await page.getByRole('button',{name:'로컬 테스트 승인',exact:true}).click();await expect(page.getByText('결제 승인이 확인됐어요.',{exact:true})).toBeVisible();
  await db.request('captain',`/api/matches/${s.m.id}/format-notices`,'POST',{playersPerTeam:4,reason:'인원에 따른 변경',requestId:crypto.randomUUID()});await db.setLocalDatabaseTime('2026-10-21T08:00:00Z');await page.goto('/#/applications');
  await page.getByRole('button',{name:'개인 사정으로 신청 취소',exact:true}).click();await page.getByRole('button',{name:'정책 확인 후 취소 접수',exact:true}).click();await expect(page.getByText('취소',{exact:true})).toBeVisible();await page.getByRole('button',{name:'환불 상태 확인',exact:true}).click();await expect(page.getByText('누적 환불 완료 5,000원',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'변경으로 불참 · 전액 환불 대상',exact:true}).click();await page.getByRole('button',{name:'환불 상태 확인',exact:true}).click();await expect(page.getByText('누적 환불 완료 10,000원',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'변경으로 불참 · 전액 환불 대상',exact:true})).toHaveCount(0);
 }finally{await db.reset();}
});
