import type {PlatformAdapter} from '@basket/core/contracts';
import {Capacitor} from '@capacitor/core';
import {App} from '@capacitor/app';
import {Browser} from '@capacitor/browser';
export type NativePorts={getPlatform():string;open(url:string):Promise<void>;subscribe(listener:(url:string)=>void):Promise<()=>void>};
const nativePorts:NativePorts={
 getPlatform:()=>Capacitor.getPlatform(),
 open:async url=>{await Browser.open({url});},
 subscribe:async listener=>{
  const handle=await App.addListener('appUrlOpen',event=>listener(event.url));
  const launch=await App.getLaunchUrl();if(launch?.url) listener(launch.url);
  return ()=>{void handle.remove();};
 },
};
export function nativePlatformKind() {const kind=Capacitor.getPlatform();return kind==='ios' || kind==='android'?kind:null;}
export async function closeNativeBrowser(){await Browser.close();}
export async function subscribeToAppState(listener:(active:boolean)=>void){return App.addListener('appStateChange',state=>listener(state.isActive));}
export function createNativePlatform(ports:NativePorts=nativePorts):PlatformAdapter {
 const kind=ports.getPlatform();if(kind!=='ios' && kind!=='android') throw new Error('NOT_NATIVE_PLATFORM');
 return {kind,openExternal:async url=>{await ports.open(externalUrl(url));},subscribeToLinks:listener=>ports.subscribe(listener)};
}
export function externalUrl(url:string):string {
 try {const parsed=new URL(url);if(parsed.protocol!=='https:' || parsed.username || parsed.password) throw new Error();return parsed.href;}
 catch {throw new Error('UNSAFE_EXTERNAL_URL');}
}
