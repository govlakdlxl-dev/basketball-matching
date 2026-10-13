import fs from 'node:fs';
import postgres from 'postgres';
const status=JSON.parse(fs.readFileSync('.env.test.json','utf8'));
const base=new URL(status.DB_URL);if(!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('LOCAL_DB_ONLY');
const name='basket_replay_'+crypto.randomUUID().replaceAll('-','');
const admin=postgres(base.href,{max:1,onnotice:()=>{}});let replay;
try{
 await admin.unsafe(`create database "${name}"`);const address=new URL(base);address.pathname='/'+name;replay=postgres(address.href,{max:1,onnotice:()=>{}});
 await replay.unsafe("create schema auth;create schema extensions;create extension pgcrypto with schema extensions;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$");
 const migrations=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();for(const file of migrations){await replay.unsafe(fs.readFileSync('supabase/migrations/'+file,'utf8'));}
 const captain=crypto.randomUUID(),member=crypto.randomUUID();await replay`insert into auth.users(id) values(${captain}),(${member})`;
 const team=(await replay`select public.api_create_team(${captain},'재실행 검증 팀','로컬','검증 자료',${crypto.randomUUID()}) result`)[0].result;await replay`update public.teams set status='approved' where id=${team.id}`;
 const startsAt=new Date(Date.now()+172800000).toISOString(),endsAt=new Date(Date.now()+180000000).toISOString();
 const input={teamId:team.id,facilityId:'b0000000-0000-4000-a000-000000000001',startsAt,endsAt,playersPerTeam:5,teamCount:2,existingPlanned:9,guestSlots:{guard:1,forward:0,center:0},baseFeeKrw:10000,policy:{version:'test-A-v1'},meetingPoint:'입구',rotationDescription:'교대',guestComposition:'개인',captainCoordination:'주장',reservationNote:'테스트',expectedPlayingMinutes:null};
 const match=(await replay`select public.api_publish_match(${captain},${replay.json(input)},${crypto.randomUUID()}) result`)[0].result;
 const app=(await replay`select public.api_submit_application(${member},${match.id},'guard',${crypto.randomUUID()}) result`)[0].result;
 await replay`select public.api_accept_application(${captain},${app.id},${crypto.randomUUID()})`;
 const order=(await replay`select public.api_create_test_order(${member},${app.id},${crypto.randomUUID()}) result`)[0].result;
 const key='fake_'+crypto.randomUUID(),receipt=(await replay`select public.api_accept_approval(${member},${order.id},${key},${crypto.randomUUID()}) result`)[0].result;
 const claim=(await replay`select public.api_claim_approval(${receipt.attemptId},'fake',false) result`)[0].result;
 const evidence={environment:'test',orderId:order.id,paymentKey:key,currency:'KRW',paymentAmountKrw:10000,approved:true,refundedKrw:0,refunds:[]};
 const paid=(await replay`select public.api_apply_payment_result(${receipt.attemptId},${claim.leaseToken},${replay.json({kind:'confirmed',evidence})}) status`)[0].status;if(paid!=='paid')throw new Error('REPLAY_APPROVAL_FAILED');
 await replay`select public.api_cancel_match(${captain},${match.id},${crypto.randomUUID()})`;
 const refundClaim=(await replay`select public.api_claim_refund(${order.id},'fake') result`)[0].result;
 const attempt=(await replay`select public.api_prepare_refund(${order.id},${refundClaim.leaseToken},${replay.json(evidence)},true) result`)[0].result;
 const refunded={...evidence,refundedKrw:10000,refunds:[{providerRefundId:'fake_'+attempt.requestId,requestId:attempt.requestId,amountKrw:10000}]};
 const result=(await replay`select public.api_finish_refund(${order.id},${refundClaim.leaseToken},${attempt.attemptId},${replay.json({kind:'confirmed',evidence:refunded})}) result`)[0].result;if(result.status!=='completed'||result.completed.refundedKrw!==10000)throw new Error('REPLAY_REFUND_FAILED');
 console.log(`${migrations.length}개 마이그레이션을 빈 임시 DB에 순서대로 적용하고 모집→수락→테스트 승인→팀 취소→전액 환불을 확인했습니다.`);
}finally{if(replay)await replay.end();await admin.unsafe(`drop database if exists "${name}"`);await admin.end();}
