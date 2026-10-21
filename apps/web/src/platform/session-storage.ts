import {createNativeSessionStorage} from '../../../mobile/src/auth-storage';
import {nativePlatformKind} from '@basket/mobile';
export function expectsNative(){return import.meta.env.VITE_NATIVE_BUILD==='true'||location.protocol==='capacitor:'||('WEBVIEW_SERVER_URL' in window&&location.hostname==='localhost');}
export function platformSessionStorage(){
 if(expectsNative()&&!nativePlatformKind())throw new Error('SECURE_BRIDGE_UNAVAILABLE');
 if(nativePlatformKind())return createNativeSessionStorage();
 return {getItem:async(k:string)=>localStorage.getItem(k),setItem:async(k:string,v:string)=>{localStorage.setItem(k,v);},removeItem:async(k:string)=>{localStorage.removeItem(k);}};
}
