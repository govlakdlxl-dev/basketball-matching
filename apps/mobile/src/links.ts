export type AppLink={kind:'auth';code:string;state:string}|{kind:'payment';orderId:string;paymentKey:string|null}|{kind:'match';matchId:string}|{kind:'notice';noticeId:string};
const uuid=(v:string|null):v is string=>Boolean(v&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v));
export function parseAppLink(input:string,httpsOrigin?:string):AppLink|null{
 try{const u=new URL(input);if(u.username||u.password||u.hash)return null;let path:string;
  if(u.protocol==='basketpilot:'&&!u.port)path='/'+u.host+u.pathname;
  else if(u.protocol==='https:'&&httpsOrigin&&u.origin===new URL(httpsOrigin).origin)path=u.pathname;else return null;
  for(const k of u.searchParams.keys())if(u.searchParams.getAll(k).length!==1)return null;
  if(path==='/auth/callback'){const code=u.searchParams.get('code'),state=u.searchParams.get('state');if(code&&code.length<=2048&&state&&state.length<=128&&!u.searchParams.has('error'))return {kind:'auth',code,state};}
  if(path==='/payment/return'){const orderId=u.searchParams.get('orderId');if(uuid(orderId))return {kind:'payment',orderId,paymentKey:null};}
  const match=path.match(/^\/matches\/([^/]+)$/);if(match&&uuid(match[1]!))return {kind:'match',matchId:match[1]!};
  const notice=path.match(/^\/notifications\/([^/]+)$/);if(notice&&uuid(notice[1]!))return {kind:'notice',noticeId:notice[1]!};return null;
 }catch{return null;}
}
export type AsyncStorage={getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;removeItem(key:string):Promise<void>};
export function createAuthTransaction(storage:AsyncStorage){let lock=Promise.resolve();return {
 async start(now=Date.now()){const state=crypto.randomUUID();await storage.setItem('basket.auth.transaction',JSON.stringify({state,expiresAt:now+600000}));return state;},
 async consume(link:Extract<AppLink,{kind:'auth'}>,now=Date.now()):Promise<string>{let unlock!:()=>void;const previous=lock;lock=new Promise<void>(r=>{unlock=r;});await previous;try{
  const raw=await storage.getItem('basket.auth.transaction');let pending;try{pending=raw?JSON.parse(raw):null;}catch{pending=null;}
  if(!pending||pending.state!==link.state||pending.expiresAt<=now)throw new Error('AUTH_TRANSACTION_INVALID');
  await storage.removeItem('basket.auth.transaction');return link.code;
 }finally{unlock();}},
 };
}
