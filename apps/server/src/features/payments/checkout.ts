import type {AuthActor,ApprovalReceipt,TermsSnapshot} from '@basket/core/contracts';
import type {Database,Env} from '../../infra/database';
import {ApiError} from '../../http/auth';
import {idField} from '../matches/commands';
import {textField} from '../accounts/handlers';
import {createPaymentCommands} from './commands';
import {configuredTestPg} from './worker';
type Ticket={ticketId:string;orderId:string;ownerId:string;amountKrw:number;nonce:string;expiresAt:string;status:string};
async function hash(token:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
function publicConfig(db:Database,env:Env){const pg=configuredTestPg(db,env);if(!pg)throw new ApiError('CONFIG_REQUIRED',503);if(pg.provider==='toss_test'&&!/^test_ck_[A-Za-z0-9_-]+$/.test(env.TOSS_TEST_CLIENT_KEY||''))throw new ApiError('CONFIG_REQUIRED',503);return {provider:pg.provider,clientKey:pg.provider==='toss_test'?env.TOSS_TEST_CLIENT_KEY!:null};}
export function createCheckout(database:Database,env:Env){
 async function resolve(token:unknown){return database.rpc<Ticket>('api_resolve_checkout',{p_hash:await hash(textField(token,128))});}
 async function refundInfo(orderId:string){const {data,error}=await database.client.from('test_orders').select('terms').eq('id',orderId).single();if(error||!data)throw new ApiError('SERVICE_UNAVAILABLE',503);const terms=data.terms as TermsSnapshot;return {policy:{version:terms.policy.version},startsAt:terms.startsAt};}
 return {
  async create(actor:AuthActor,input:Record<string,unknown>){
   if(Object.keys(input).some(k=>!['orderId','requestId'].includes(k)))throw new ApiError('INVALID_INPUT',400);
   const config=publicConfig(database,env),bytes=crypto.getRandomValues(new Uint8Array(32)),token=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const ticket=await database.rpc<Record<string,unknown>>('api_create_checkout_ticket',{p_actor:actor.userId,p_order:idField(input.orderId),p_request_id:textField(input.requestId,128),p_token:token,p_hash:await hash(token)});return {...ticket,...config,...await refundInfo(ticket.orderId as string)};
  },
  async data(input:Record<string,unknown>){const t=await resolve(input.token);return {orderId:t.orderId,amountKrw:t.amountKrw,nonce:t.nonce,expiresAt:t.expiresAt,returnToken:textField(input.token,128),...publicConfig(database,env),...await refundInfo(t.orderId)};},
  async status(input:Record<string,unknown>){const t=await resolve(input.token);return {orderId:t.orderId,status:t.status};},
  async receive(input:Record<string,unknown>):Promise<ApprovalReceipt>{
   if(Object.keys(input).some(k=>!['token','orderId','paymentKey','amount'].includes(k)))throw new ApiError('INVALID_INPUT',400);
   const t=await resolve(input.token);if(input.orderId!==t.orderId||input.amount!==t.amountKrw)throw new ApiError('INVALID_INPUT',400);
   return createPaymentCommands(database).acceptApproval({userId:t.ownerId},{orderId:t.orderId,paymentKey:input.paymentKey,requestId:t.ticketId});
  },
 };
}
