import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
beforeAll(async()=>{db=await createDatabaseFixture();});afterAll(async()=>{await db?.reset();});
const input={name:'<img src=x onerror=alert(1)>',address:'서울 성동구 테스트 주소',point:{lat:37.5,lng:127},region:'seoul',registration:'manual_pin',sourceUrl:null,evidence:'로컬 검증 시설',requestId:'facility-test'};
test('미승인 팀과 일반 회원은 시설을 게시하지 못한다',async()=>{
 expect((await db.request('captain','/api/facilities','POST',input)).status).toBe(403);
 expect((await db.request('memberA','/api/facilities','POST',input)).status).toBe(403);
});
test('승인 담당자가 검색 없는 시설을 추가해도 확인 상태를 위조하지 못한다',async()=>{
 await db.sql`update public.teams set status='approved' where id=${db.teamId}`;
 const response=await db.request('captain','/api/facilities','POST',{...input,locationStatus:'verified',basketballUseStatus:'verified'});
 expect(response.status).toBe(200);
 const result=await response.json() as {id:string;name:string;locationStatus:string;basketballUseStatus:string};
 expect(result.name).toBe(input.name);expect(result.locationStatus).toBe('unverified');expect(result.basketballUseStatus).toBe('unverified');
 const repeated=await db.request('captain','/api/facilities','POST',input);
 expect((await repeated.json() as {id:string}).id).toBe(result.id);
});
test('공개 시설 목록에 등록자의 비공개 증빙·개인 ID가 없다',async()=>{
 const response=await db.request('memberB','/api/facilities');expect(response.status).toBe(200);
 const rows=await response.json() as Record<string,unknown>[];
 expect(rows.some(row=>row.name===input.name)).toBe(true);
 for(const row of rows) {expect(row).not.toHaveProperty('evidence');expect(row).not.toHaveProperty('registeredBy');}
});
test('경로 키가 없으면 조회 성공으로 꾸미지 않는다',async()=>{
 const facility=(await db.sql`select id from public.facilities limit 1`)[0]!;
 const response=await db.request('memberB','/api/routes','POST',{origin:{lat:37.5,lng:127},facilityId:facility.id,mode:'subway'});
 expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'unknown',reason:'CONFIG_REQUIRED'});
});
