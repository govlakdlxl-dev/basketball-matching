export type PushBinding={endpointId:string;ownerVersion:number;userId:string};
export type PushActor={userId:string;token:string};
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function noticeTarget(data:unknown):string{
 const value=data as {noticeIds?:unknown};let ids=value?.noticeIds;
 if(typeof ids==='string'){try{ids=JSON.parse(ids);}catch{ids=[];}}
 const id=Array.isArray(ids)?ids.find(x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)):null;
 return id?'/notifications/'+id:'/notifications';
}
export function createPushLifecycle(storage:StoragePort,remove:(binding:PushBinding,token:string)=>Promise<void>,clear:()=>Promise<void>,prefix='basket.push'){
 const read=<T>(key:string,fallback:T):T=>{try{return JSON.parse(storage.getItem(prefix+key)||'null')??fallback;}catch{return fallback;}};
 const pending=()=>read<PushBinding[]>('.pending',[]);
 const persist=(rows:PushBinding[])=>storage.setItem(prefix+'.pending',JSON.stringify(rows));
 const erase=(b:PushBinding)=>persist(pending().filter(p=>p.endpointId!==b.endpointId||p.ownerVersion!==b.ownerVersion||p.userId!==b.userId));
 async function release(b:PushBinding,token:string){try{await remove(b,token);erase(b);}catch(error){
  // 소유권·버전이 바뀐 응답은 이미 끝난 이전 연결입니다.
  if(error instanceof Error&&['FORBIDDEN','STALE_ENDPOINT','NOT_FOUND'].includes(error.message)){erase(b);return;}
  const rows=pending();if(!rows.some(p=>p.endpointId===b.endpointId&&p.ownerVersion===b.ownerVersion&&p.userId===b.userId))persist([...rows,b]);
 }}
 return {
  binding:()=>read<PushBinding|null>('.binding',null),
  bind:(b:PushBinding)=>storage.setItem(prefix+'.binding',JSON.stringify(b)),
  release,
  pendingCount:(userId:string)=>pending().filter(p=>p.userId===userId).length,
  async leave(actor:PushActor){const b=read<PushBinding|null>('.binding',null);if(b?.userId!==actor.userId)return;storage.removeItem(prefix+'.binding');try{await clear();}finally{await release(b,actor.token);}},
  async retry(actor:PushActor){for(const b of pending().filter(p=>p.userId===actor.userId))await release(b,actor.token);},
 };
}
