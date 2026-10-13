import './map.css';
import type {MapCommand,MapEvent} from '@basket/core/map-protocol';
import {isPoint} from '@basket/core/preferences';
import type {KMap,KMarker,Overlay} from './kakao-types';

const params=new URLSearchParams(location.search),nonce=params.get('nonce') || '',parentOrigin=params.get('parentOrigin') || '';
const allowed=(import.meta.env.VITE_MAP_PARENT_ORIGINS as string | undefined)?.split(',').map(s=>s.trim()).filter(Boolean) || [];
const trusted=nonce.length>=16 && nonce.length<=128 && allowed.includes(parentOrigin) && parentOrigin!=='*';
const container=document.querySelector<HTMLElement>('#map')!,status=document.querySelector<HTMLElement>('#map-status')!;
let map:KMap|null=null,overlays:Overlay[]=[],marker:KMarker|null=null,selected:string|null=null,last:MapCommand|null=null,first=true;
function emit(value:MapEvent) {if(trusted && window.parent!==window) window.parent.postMessage(value,parentOrigin);}
function fail(code:string) {status.textContent='지도를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';emit({type:'error',nonce,code});}
function draw(command:MapCommand) {
 const K=window.kakao?.maps;if(!K || !map) return;
 map.relayout();overlays.forEach(o=>o.setMap(null));overlays=[];marker?.setMap(null);marker=null;
 if(command.type==='pick_point') {
  const center=new K.LatLng(command.center.lat,command.center.lng);map.setCenter(center);map.setLevel(5);
  marker=new K.Marker({position:center,draggable:true});marker.setMap(map);
  const send=()=>{const point=marker!.getPosition();emit({type:'point_selected',nonce,point:{lat:point.getLat(),lng:point.getLng()}});};
  K.event.addListener(marker,'dragend',send);status.textContent='지도를 누르거나 핀을 움직여 위치를 골라 주세요.';return;
 }
 status.textContent='지도 © Kakao · 시설 위치';
 const bounds=new K.LatLngBounds();
 for(const [index,item] of command.points.entries()) {
  const point=new K.LatLng(item.point.lat,item.point.lng);bounds.extend(point);
  const button=document.createElement('button');button.className='kpin'+(selected===item.id ? ' sel':'');button.setAttribute('aria-label',item.label);
  const number=document.createElement('b'),text=document.createElement('span');text.textContent=String(index+1);number.append(text);button.append(number);
  button.onclick=()=>{selected=selected===item.id?null:item.id;draw(command);emit({type:'point_selected',nonce,point:item.point});};
  overlays.push(new K.CustomOverlay({position:point,content:button,xAnchor:.5,yAnchor:1,zIndex:selected===item.id?5:3}));
  if(selected===item.id) {const name=document.createElement('div');name.className='kname';name.textContent=item.label;overlays.push(new K.CustomOverlay({position:point,content:name,xAnchor:.5,yAnchor:2.2,zIndex:6}));}
 }
 overlays.forEach(o=>o.setMap(map));
 if(first && command.points.length) {map.setBounds(bounds);first=false;}
}
function validCommand(value:unknown):value is MapCommand {
 if(!value || typeof value!=='object' || Array.isArray(value)) return false;
 const v=value as Record<string,unknown>;if(v.nonce!==nonce) return false;
 if(v.type==='pick_point') return Object.keys(v).sort().join(',')==='center,nonce,type' && isPoint(v.center);
 if(v.type!=='show_points' || Object.keys(v).sort().join(',')!=='nonce,points,type' || !Array.isArray(v.points) || v.points.length>200) return false;
 return v.points.every(p=>p && typeof p==='object' && typeof p.id==='string' && p.id.length<=128 && typeof p.label==='string' && p.label.length<=300 && isPoint(p.point) && Object.keys(p).sort().join(',')==='id,label,point');
}
window.addEventListener('message',event=>{
 if(!trusted || event.source!==window.parent || event.origin!==parentOrigin || !validCommand(event.data)) return;
 last=event.data;draw(last);
});
async function start() {
 if(!trusted) {fail('UNTRUSTED_PARENT');return;}
 // 기존 시안 config.js를 우선 재사용. 운영 빌드는 공개 JavaScript 키 환경 설정도 지원합니다.
 await new Promise<void>(resolve=>{const sc=document.createElement('script');sc.src='/config.js';sc.onload=()=>resolve();sc.onerror=()=>resolve();document.head.append(sc);});
 const key=window.KAKAO_APP_KEY || import.meta.env.VITE_KAKAO_MAP_JS_KEY;
 if(!key) {fail('CONFIG_REQUIRED');return;}
 const sc=document.createElement('script');sc.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
 sc.onerror=()=>fail('SDK_UNAVAILABLE');sc.onload=()=>{
  try {window.kakao!.maps.load(()=>{
   const K=window.kakao!.maps;map=new K.Map(container,{center:new K.LatLng(37.54,126.93),level:9});
   K.event.addListener(map,'click',event=>{if(last?.type!=='pick_point' || !event.latLng || !marker) return;marker.setPosition(event.latLng);emit({type:'point_selected',nonce,point:{lat:event.latLng.getLat(),lng:event.latLng.getLng()}});});
   status.textContent='지도 © Kakao';emit({type:'ready',nonce});if(last) draw(last);
  });} catch {fail('SDK_UNAVAILABLE');}
 };document.head.append(sc);
}
void start();
