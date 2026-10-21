import type {UtcInstant,DomainEvent} from '@basket/core/contracts';
import type {DeliveryPort} from '@basket/core/notifications/contracts';
import type {Database} from '../infra/database';
import {parseInstant} from '@basket/core/time';
import {planNotifications} from '@basket/core/notifications/planner';
import {createNotificationSnapshots} from '../features/notifications/snapshot';
import {createNotificationRepository} from '../features/notifications/repository';
import {createNotificationDispatcher} from '../features/notifications/dispatch';
export type TickReport={consumedEvents:number;claimedJobs:number;providerAccepted:number;suppressed:number;setupRequired:number;failed:number;unknown:number};
export function createNotificationTick(database:Database,push:DeliveryPort,alimtalk:DeliveryPort){return {async runNotificationTick(now:UtcInstant,workerId:string):Promise<TickReport>{
 parseInstant(now);const report:TickReport={consumedEvents:0,claimedJobs:0,providerAccepted:0,suppressed:0,setupRequired:0,failed:0,unknown:0};
 const input=await database.rpc<{now:string;events:DomainEvent[];matchIds:string[]}>('api_notification_tick_input'),snapshots=createNotificationSnapshots(database),repo=createNotificationRepository(database);
 for(const event of input.events){try{const plan=planNotifications(event,await snapshots.loadNotificationSnapshot(event.matchId),input.now);if(await database.rpc<boolean>('api_consume_notification_event',{p_event:event.id,p_plan:plan}))report.consumedEvents++;}catch{report.failed++;}}
 for(const id of input.matchIds){try{await repo.persistNotificationPlan(null,planNotifications(null,await snapshots.loadNotificationSnapshot(id),input.now));}catch{report.failed++;}}
 const claims=await repo.claimNotificationJobs(workerId,input.now);report.claimedJobs=claims.length;
 // 동시에 최대 8건을 처리해 60초 lease 안에 전송을 시작합니다.
 let cursor=0;await Promise.all(Array.from({length:Math.min(8,claims.length)},async()=>{while(cursor<claims.length){const claim=claims[cursor++]!;try{
  const dispatcher=createNotificationDispatcher(database),port:DeliveryPort={send:envelope=>(envelope.transport==='push'?push:alimtalk).send(envelope)},r=await dispatcher.dispatchNotificationJob(claim,port);
  const key={provider_accepted:'providerAccepted',suppressed:'suppressed',setup_required:'setupRequired',failed:'failed',unknown:'unknown'} as const;report[key[r.status]]++;
 }catch{report.failed++;}}}));return report;
}};}
