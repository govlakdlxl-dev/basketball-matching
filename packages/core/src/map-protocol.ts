import type { Id, Point } from './contracts';
export type MapCommand = {type:'show_points';nonce:string;points:{id:Id;point:Point;label:string}[]} | {type:'pick_point';nonce:string;center:Point};
export type MapEvent = {type:'ready';nonce:string} | {type:'point_selected';nonce:string;point:Point} | {type:'error';nonce:string;code:string};
export type MapTrustContext = {origin:string;expectedOrigin:string;source:unknown;expectedSource:unknown;nonce:string};
