import fs from 'node:fs';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthActor } from '@basket/core/contracts';
import type { Preferences } from '@basket/core/preferences';
import type { Env } from '../../../apps/server/src/infra/database';
import worker from '../../../apps/server/src/index';

export function loadLocalStatus() {
  const status = JSON.parse(fs.readFileSync('.env.test.json','utf8')) as Record<string,string>;
  if (!status.API_URL || !status.DB_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error('LOCAL_DB_NOT_CONFIGURED');
  for (const key of ['API_URL','DB_URL'] as const) if (!['127.0.0.1','localhost'].includes(new URL(status[key]!).hostname)) throw new Error('LOCAL_DB_ONLY');
  return status as Record<string,string> & { API_URL:string; DB_URL:string; ANON_KEY:string; SERVICE_ROLE_KEY:string };
}

export async function createDatabaseFixture() {
  const status = loadLocalStatus();
  const env: Env = { SUPABASE_URL:status.API_URL, SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY };
  const sql = postgres(status.DB_URL,{max:1});
  const admin = createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const names = ['memberA','memberB','captain','operator'] as const;
  type Member = typeof names[number];
  const users = {} as Record<Member,{actor:AuthActor;token:string;client:SupabaseClient;email:string;password:string}>;
  for (const name of names) {
    const email = `${crypto.randomUUID()}@example.invalid`, password = crypto.randomUUID()+'!aA1';
    const {data,error} = await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{nickname:name}});
    if (error || !data.user) throw new Error('LOCAL_USER_SETUP_FAILED');
    const client = createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const signIn = await client.auth.signInWithPassword({email,password});
    if (signIn.error || !signIn.data.session) throw new Error('LOCAL_SESSION_SETUP_FAILED');
    users[name] = {actor:{userId:data.user.id},token:signIn.data.session.access_token,client,email,password};
  }
  const teamResult = await admin.rpc('api_create_team',{p_actor:users.captain.actor.userId,p_name:'권한 검증 팀',p_contact_route:'로컬 테스트',p_evidence:'외부 모집을 하지 않는 테스트 팀',p_request_id:crypto.randomUUID()});
  if (teamResult.error) throw new Error('LOCAL_TEAM_SETUP_FAILED: '+teamResult.error.code);
  const teamId = (teamResult.data as {id:string}).id;
  await sql`insert into private.operator_users(user_id) values (${users.operator.actor.userId})`;
  const preferences: Preferences = {origin:{lat:37.5,lng:126.7},mode:'subway',maxMinutes:30,dateFrom:'2026-10-13',dateTo:'2026-10-20',weekdays:[1,2,3,4,5],earliestStartMinute:1080,latestStartMinute:1380,latestEndMinute:null,position:null};
  return {
    ...Object.fromEntries(names.map(name=>[name,users[name].actor])) as Record<Member,AuthActor>,
    clientA:users.memberA.client,clientB:users.memberB.client,admin,sql,env,teamId,preferences,
    tokens:Object.fromEntries(names.map(name=>[name,users[name].token])) as Record<Member,string>,
    logins:Object.fromEntries(names.map(name=>[name,{email:users[name].email,password:users[name].password}])) as Record<Member,{email:string;password:string}>,
    async request(member:Member,path:string,method='GET',body?:unknown) {
      return worker.fetch(new Request('https://basket.test'+path,{method,headers:{authorization:'Bearer '+users[member].token,'content-type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)})}),env);
    },
    async setLocalDatabaseTime(instant:string) {
      const time = new Date(instant);
      if (!Number.isFinite(time.getTime())) throw new Error('INVALID_TEST_TIME');
      await sql.unsafe(`create or replace function public.server_now() returns timestamptz language sql volatile set search_path='' as $$select '${time.toISOString()}'::timestamptz$$`);
    },
    async reset() {
      await sql.unsafe("create or replace function public.server_now() returns timestamptz language sql volatile set search_path='' as $$select clock_timestamp()$$");
      const ids = names.map(name=>users[name].actor.userId);
      await sql`delete from public.issues where reporter_id in ${sql(ids)}`;
      await sql`delete from private.account_deletion_requests where user_id in ${sql(ids)}`;
      const ownedMatches=await sql`select id from public.matches where created_by in ${sql(ids)}`;
      if(ownedMatches.length) {
        const matches=ownedMatches.map(row=>row.id as string);
        await sql`delete from private.fake_pg_payments where order_id in (select id from public.test_orders where match_id in ${sql(matches)})`;
        await sql`delete from public.approval_attempts where order_id in (select id from public.test_orders where match_id in ${sql(matches)})`;
        await sql`delete from public.test_orders where match_id in ${sql(matches)}`;
        await sql`delete from public.activity_records where match_id in ${sql(matches)}`;
        await sql`delete from public.format_acknowledgements where notice_id in (select id from public.format_notices where match_id in ${sql(matches)})`;
        await sql`delete from public.cancellation_receipts where match_id in ${sql(matches)}`;
        await sql`delete from public.format_notices where match_id in ${sql(matches)}`;
        await sql`delete from public.match_host_reports where match_id in ${sql(matches)}`;
        await sql`delete from public.applications where match_id in ${sql(matches)}`;
        await sql`delete from public.matches where id in ${sql(matches)}`;
      }
      await sql`delete from public.activity_records where actor_id in ${sql(ids)}`;
      await sql`delete from public.command_receipts where actor_id in ${sql(ids)}`;
      await sql`delete from public.facilities where registered_by in ${sql(ids)}`;
      await sql`delete from private.operator_users where user_id in ${sql(ids)}`;
      await sql`delete from public.team_memberships where user_id in ${sql(ids)}`;
      await sql`delete from public.teams where created_by in ${sql(ids)}`;
      for (const name of names) await admin.auth.admin.deleteUser(users[name].actor.userId);
      await sql`delete from public.profiles where id in ${sql(ids)}`;
      await sql.end();
    },
  };
}
