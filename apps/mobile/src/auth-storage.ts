import {registerPlugin} from '@capacitor/core';
export type VaultPort={getItem(input:{key:string}):Promise<{value:string|null}>;setItem(input:{key:string;value:string}):Promise<void>;removeItem(input:{key:string}):Promise<void>};
const Vault=registerPlugin<VaultPort>('SessionVault');
export function createNativeSessionStorage(vault:VaultPort=Vault){return {
 getItem:async(key:string)=>(await vault.getItem({key})).value,
 setItem:(key:string,value:string)=>vault.setItem({key,value}),
 removeItem:(key:string)=>vault.removeItem({key}),
 get:async()=>(await vault.getItem({key:'basket.session'})).value,
 set:(value:string)=>vault.setItem({key:'basket.session',value}),
 clear:()=>vault.removeItem({key:'basket.session'}),
};}
