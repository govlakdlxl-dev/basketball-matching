export const supportedWebPushHosts=['fcm.googleapis.com','updates.push.services.mozilla.com'] as const;
export function validateWebPushEndpoint(endpoint:string,allowedHosts:readonly string[]):URL{
 try{const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!allowedHosts.includes(url.hostname)||url.hash||url.hostname==='localhost'||url.hostname.includes(':')||/^\d+(\.\d+){3}$/.test(url.hostname))throw new Error();return url;}catch{throw new Error('INVALID_PUSH_ENDPOINT');}
}
export function decodeBase64Url(value:string):Uint8Array{if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('INVALID_PUSH_REGISTRATION');try{const text=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(text,c=>c.charCodeAt(0));}catch{throw new Error('INVALID_PUSH_REGISTRATION');}}
export async function validatePushRegistration(channel:string,registration:Record<string,unknown>,allowedHosts:readonly string[]=supportedWebPushHosts):Promise<Record<string,string>>{
 if(channel==='apns'||channel==='fcm'){
  if(Object.keys(registration).length!==1||typeof registration.token!=='string'||(channel==='apns'?!/^(?:[a-f0-9]{2}){1,2048}$/i.test(registration.token):!/^[A-Za-z0-9_:.-]{16,4096}$/.test(registration.token)))throw new Error('INVALID_PUSH_REGISTRATION');return {token:channel==='apns'?registration.token.toLowerCase():registration.token};
 }
 if(channel!=='webpush'||Object.keys(registration).length!==3||!['endpoint','p256dh','auth'].every(k=>typeof registration[k]==='string'))throw new Error('INVALID_PUSH_REGISTRATION');
 const endpoint=validateWebPushEndpoint(registration.endpoint as string,allowedHosts),key=decodeBase64Url(registration.p256dh as string),auth=decodeBase64Url(registration.auth as string);if(key.length!==65||key[0]!==4||auth.length!==16)throw new Error('INVALID_PUSH_REGISTRATION');
 try{await crypto.subtle.importKey('raw',key.buffer as ArrayBuffer,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{throw new Error('INVALID_PUSH_REGISTRATION');}
 return {endpoint:endpoint.href,p256dh:registration.p256dh as string,auth:registration.auth as string};
}
