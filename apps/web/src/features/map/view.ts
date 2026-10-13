import type {MapCommand,MapEvent} from '@basket/core/map-protocol';
import {validateMapEvent} from './protocol';
export function mapView(command:Omit<Extract<MapCommand,{type:'show_points'}>,'nonce'>|Omit<Extract<MapCommand,{type:'pick_point'}>,'nonce'>,onPoint:(event:Extract<MapEvent,{type:'point_selected'}>)=>void) {
 const root=document.createElement('section');root.className='mapbox';
 const iframe=document.createElement('iframe');iframe.title=command.type==='pick_point'?'지도에서 출발지 선택':'실제 농구장 위치';iframe.className='map-frame';iframe.referrerPolicy='strict-origin';
 const status=document.createElement('p');status.className='map-caption muted';status.setAttribute('role','status');status.textContent='카카오 지도를 불러오는 중…';root.append(iframe,status);
 const nonce=crypto.randomUUID(),origin=import.meta.env.VITE_MAP_ORIGIN as string | undefined;
 let expected:string;
 try {const url=new URL(origin || location.origin);expected=url.origin;if(url.protocol!=='https:' && !(import.meta.env.DEV && url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error();
  const src=new URL('/map.html',expected);src.searchParams.set('nonce',nonce);src.searchParams.set('parentOrigin',location.origin);iframe.src=src.href;
 } catch {status.textContent='지도 연결을 준비하고 있어요.';return root;}
 function receive(event:MessageEvent) {
  const value=validateMapEvent(event.data,{origin:event.origin,expectedOrigin:expected,source:event.source,expectedSource:iframe.contentWindow,nonce});
  if(!value) return;
  if(value.type==='ready') {iframe.contentWindow?.postMessage({...command,nonce},expected);status.textContent='시설 위치를 선택하면 아래 목록에서 확인할 수 있어요.';}
  else if(value.type==='point_selected') onPoint(value);
  else status.textContent='카카오맵 연결을 확인해 주세요. 시설 주소와 길찾기 링크는 이용할 수 있어요.';
 }
 window.addEventListener('message',receive);
 const observer=new MutationObserver(()=>{if(!root.isConnected){window.removeEventListener('message',receive);observer.disconnect();}});
 // 최초 장착 전 제거로 판단하지 않도록 다음 프레임에서 감시를 시작합니다.
 requestAnimationFrame(()=>{if(root.isConnected) observer.observe(document.body,{childList:true,subtree:true});});
 return root;
}
