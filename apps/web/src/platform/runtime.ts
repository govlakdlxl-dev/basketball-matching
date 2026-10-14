import type {PlatformAdapter} from '@basket/core/contracts';
import {createNativePlatform,nativePlatformKind,externalUrl} from '@basket/mobile';
import {expectsNative} from './session-storage';
export function createWebPlatform():PlatformAdapter {
 return {kind:'web',openExternal:async url=>{window.open(externalUrl(url),'_blank','noopener,noreferrer');},subscribeToLinks:async listener=>{
  const emit=()=>listener(location.href);window.addEventListener('popstate',emit);emit();return()=>window.removeEventListener('popstate',emit);
 }};
}
export function createPlatform():PlatformAdapter {if(expectsNative()&&!nativePlatformKind())throw new Error('SECURE_BRIDGE_UNAVAILABLE');return nativePlatformKind()?createNativePlatform():createWebPlatform();}
