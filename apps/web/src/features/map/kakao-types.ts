// 사용한 SDK 표면만 선언합니다. 실제 SDK는 기존 JavaScript 키로 로드합니다.
export interface LatLng {getLat():number;getLng():number}
export interface KMap {relayout():void;setCenter(point:LatLng):void;setLevel(level:number):void;setBounds(bounds:LatLngBounds):void}
export interface LatLngBounds {extend(point:LatLng):void}
export interface Overlay {setMap(map:KMap|null):void}
export interface KMarker extends Overlay {getPosition():LatLng;setPosition(point:LatLng):void}
export interface KakaoMaps {
 load(callback:()=>void):void;
 Map:new(element:HTMLElement,options:{center:LatLng;level:number})=>KMap;
 LatLng:new(lat:number,lng:number)=>LatLng;
 LatLngBounds:new()=>LatLngBounds;
 CustomOverlay:new(options:{position:LatLng;content:HTMLElement;xAnchor?:number;yAnchor?:number;zIndex?:number})=>Overlay;
 Marker:new(options:{position:LatLng;draggable?:boolean})=>KMarker;
 event:{addListener(target:unknown,event:string,callback:(event:{latLng?:LatLng})=>void):void};
}
declare global {interface Window {KAKAO_APP_KEY?:string;kakao?:{maps:KakaoMaps}}}
