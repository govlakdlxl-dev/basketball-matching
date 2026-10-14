import {test,expect} from '@playwright/test';
import {createDatabaseFixture} from '../integration/fixtures/database';
import {acceptedPayment} from '../integration/fixtures/payments';
for(const policy of ['test-A-v1','test-B-v1'])test(`신청 당시 ${policy} 정책을 참여 내역과 외부 checkout에서 다시 확인한다`,async({page})=>{
 const db=await createDatabaseFixture();try{await db.sql`update public.teams set status='approved' where id=${db.teamId}`;const s=await acceptedPayment(db,10000,false);
  // 기존 스냅숏을 기준으로 정책 A/B를 각각 구성합니다. 현재 모집의 정책과는 분리합니다.
  await db.sql`update public.applications set terms=jsonb_set(terms,'{policy}',${db.sql.json({version:policy})}) where id=${s.a.id}`;
  await db.sql`update public.test_orders set terms=jsonb_set(terms,'{policy}',${db.sql.json({version:policy})}) where id=${s.order!.id}`;
  await page.goto('/#/hosting');await page.getByLabel('테스트 이메일').fill(db.logins.memberA.email);await page.getByLabel('테스트 비밀번호').fill(db.logins.memberA.password);await page.getByRole('button',{name:'테스트 계정 로그인',exact:true}).click();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();await page.goto('/#/applications');
  const label=policy==='test-A-v1'?'개인 취소: 시작 2시간 전까지 100% 환불, 그 이후 0% 환불.':'개인 취소: 시작 24시간 전까지 100%, 24시간 미만부터 2시간 전까지 50%, 2시간 미만 0% 환불.';
  await expect(page.getByText(label,{exact:true})).toBeVisible();await page.getByRole('button',{name:'테스트 결제하기',exact:true}).click();await expect(page.getByText(label,{exact:true})).toBeVisible();await expect(page.getByText('주최자 취소·방식 변경으로 불참: 전액 환불 기준',{exact:true})).toBeVisible();await page.getByRole('button',{name:'로컬 테스트 승인',exact:true}).click();await expect(page.getByText('결제 승인이 확인됐어요.',{exact:true})).toBeVisible();
 }finally{await db.reset();}
});
