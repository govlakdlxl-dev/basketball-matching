import type {DeliveryEnvelope,DeliveryResult} from '@basket/core/notifications/contracts';
export const pushTitle='농구 매칭',pushBody='새 안내가 있습니다. 앱 또는 웹에서 확인해 주세요.';
export const result=(status:DeliveryResult['status'],reason:string|null=null,providerMessageId:string|null=null):DeliveryResult=>({status,reason,providerMessageId});
export function remainingSeconds(envelope:DeliveryEnvelope,now=Date.now()):number{return envelope.expiresAt?Math.max(0,Math.min(2419200,Math.floor((Date.parse(envelope.expiresAt)-now)/1000))):300;}
export function pushData(envelope:DeliveryEnvelope){return {noticeIds:envelope.noticeIds,matchId:envelope.matchId,...(envelope.applicationId?{applicationId:envelope.applicationId}:{})};}
export function base64url(value:Uint8Array){return btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export async function signJwt(header:Record<string,unknown>,claims:Record<string,unknown>,pem:string,algorithm:'ES256'|'RS256'):Promise<string>{
 const raw=atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey('pkcs8',bytes.buffer as ArrayBuffer,algorithm==='ES256'?{name:'ECDSA',namedCurve:'P-256'}:{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const data=base64url(new TextEncoder().encode(JSON.stringify(header)))+'.'+base64url(new TextEncoder().encode(JSON.stringify(claims))),signature=await crypto.subtle.sign(algorithm==='ES256'?{name:'ECDSA',hash:'SHA-256'}:{name:'RSASSA-PKCS1-v1_5'},key,new TextEncoder().encode(data));return data+'.'+base64url(new Uint8Array(signature));
}
