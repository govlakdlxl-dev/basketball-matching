import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import worker from '../../apps/server/src/index';
import { createDatabaseFixture } from './fixtures/database';

test('로그인 없이 actor 값을 전송해도 개인 조건을 읽지 못한다', async () => {
  const response = await worker.fetch(new Request('https://basket.test/api/me/preferences?actor=operator'));
  expect(response.status).toBe(401);
});

test('자격이 없는 문자열을 bearer로 넣어도 회원으로 처리하지 않는다', async () => {
  const response = await worker.fetch(new Request('https://basket.test/api/me/preferences', { headers: { authorization: 'Bearer forged-token' } }));
  expect(response.status).toBe(401);
});

describe('공유 DB의 회원 소유권', () => {
  let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
  beforeAll(async () => { fixture = await createDatabaseFixture(); });
  afterAll(async () => { await fixture?.reset(); });

  test('회원 A 조건은 실제 DB에 저장되고 재조회된다', async () => {
    const saved = await fixture.request('memberA','/api/me/preferences','PUT',fixture.preferences);
    expect(saved.status).toBe(200);
    const loaded = await fixture.request('memberA','/api/me/preferences');
    expect(await loaded.json()).toEqual(fixture.preferences);
  });
  test('회원 B는 A의 비공개 프로필을 직접 조회하지 못한다', async () => {
    const { data } = await fixture.clientB.from('profiles').select('preferences').eq('id',fixture.memberA.userId);
    expect(data).toEqual([]);
  });
  test('미승인 팀의 주장도 담당자 역할을 확대하지 못한다', async () => {
    const response = await fixture.request('captain',`/api/teams/${fixture.teamId}/members`,'POST',{userId:fixture.memberB.userId,role:'secretary',active:true,requestId:crypto.randomUUID()});
    expect(response.status).toBe(403);
  });
  test('회원이 운영자 승인 경로를 호출하면 거부된다', async () => {
    const response = await fixture.request('memberA',`/api/operator/teams/${fixture.teamId}/review`,'POST',{decision:'approved',reason:'직접 승인',requestId:crypto.randomUUID()});
    expect(response.status).toBe(403);
  });
  test('잘못된 날짜·좌표는 본인 요청이어도 저장하지 않는다', async () => {
    const response = await fixture.request('memberB','/api/me/preferences','PUT',{...fixture.preferences,dateTo:'2026-02-30',origin:{lat:37,lng:181}});
    expect(response.status).toBe(400);
    expect(await (await fixture.request('memberB','/api/me/preferences')).json()).toBeNull();
  });
  test('승인 팀이라도 비활성 담당자와 다른 팀 담당자는 권한이 없다', async () => {
    await fixture.sql`update public.teams set status='approved' where id=${fixture.teamId}`;
    await fixture.sql`update public.team_memberships set active=false where team_id=${fixture.teamId} and user_id=${fixture.captain.userId}`;
    const input = {userId:fixture.memberB.userId,role:'secretary',active:true,requestId:crypto.randomUUID()};
    expect((await fixture.request('captain',`/api/teams/${fixture.teamId}/members`,'POST',input)).status).toBe(403);
    await fixture.sql`update public.team_memberships set active=true where team_id=${fixture.teamId} and user_id=${fixture.captain.userId}`;
    expect((await fixture.request('memberA',`/api/teams/${fixture.teamId}/members`,'POST',{...input,requestId:crypto.randomUUID()})).status).toBe(403);
    expect((await fixture.request('captain',`/api/teams/${fixture.teamId}/members`,'POST',{...input,requestId:crypto.randomUUID()})).status).toBe(200);
  });
});
