import {test,expect} from '@playwright/test';
import {createDatabaseFixture} from '../integration/fixtures/database';
test('주장이 공개한 무료 경기의 게스트 신청을 수락하면 다른 계정에도 확정이 표시된다',async({page})=>{
 const db=await createDatabaseFixture();
 async function login(member:'memberA'|'captain') {
  await page.goto('/#/hosting');await page.getByLabel('테스트 이메일').fill(db.logins[member].email);await page.getByLabel('테스트 비밀번호').fill(db.logins[member].password);await page.getByRole('button',{name:'테스트 계정 로그인',exact:true}).click();await expect(page.getByRole('button',{name:'로그아웃',exact:true})).toBeVisible();
 }
 async function logout(){await page.goto('/#/hosting');await page.getByRole('button',{name:'로그아웃',exact:true}).click();}
 try {
  await db.sql`update public.teams set status='approved' where id=${db.teamId}`;
  await login('captain');
  const start=new Date();start.setUTCDate(start.getUTCDate()+1);start.setUTCHours(11,0,0,0);const end=new Date(start.getTime()+7200000);
  const local=(time:Date)=>new Date(time.getTime()+9*3600000).toISOString().slice(0,16);
  await page.getByLabel('경기 시작 (한국 시간)').fill(local(start));await page.getByLabel('경기 종료 (한국 시간)').fill(local(end));
  await page.getByLabel('기존 예정 인원').fill('9');await page.getByLabel('가드 모집').fill('1');await page.getByLabel('포워드 모집').fill('0');await page.getByLabel('센터 모집').fill('0');await page.getByLabel('기본 참가비 (원)').fill('0');
  const published=page.waitForResponse(response=>response.url().endsWith('/api/matches') && response.request().method()==='POST');
  await page.getByRole('button',{name:'게스트 모집 공개',exact:true}).click();const match=await (await published).json() as {id:string};expect(match.id).toBeTruthy();
  await logout();await login('memberA');await page.goto(`/#/matches/${match.id}`);
  await page.getByRole('button',{name:'신청 보내기',exact:true}).click();await expect(page.getByText('신청을 보냈어요. 주장의 수락을 기다려 주세요.',{exact:true})).toBeVisible();
  await logout();await login('captain');
  const hosted=page.getByTestId(`hosting-${match.id}`);await hosted.getByRole('button',{name:'신청자 보기',exact:true}).click();await hosted.getByRole('button',{name:'수락',exact:true}).click();await expect(hosted.getByText('참가 확정',{exact:true})).toBeVisible();
  await logout();await login('memberA');await page.goto('/#/applications');
  await expect(page.getByText('참가 확정',{exact:true})).toBeVisible();await expect(page.getByText('서울교육문화센터 실내체육관(농구장)',{exact:true})).toBeVisible();
  expect((await db.sql`select starts_at from public.matches where id=${match.id}`)[0]!.starts_at.toISOString()).toBe(start.toISOString());
 } finally {await db.reset();}
});
