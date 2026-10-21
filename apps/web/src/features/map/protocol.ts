import type { MapEvent, MapTrustContext } from '@basket/core/map-protocol';
import { isPoint } from '@basket/core/preferences';
export function validateMapEvent(value:unknown,context:MapTrustContext):MapEvent|null {
 if(!context.expectedSource || context.source!==context.expectedSource || !context.nonce || context.origin!==context.expectedOrigin || context.expectedOrigin==='*') return null;
 if(!value || typeof value!=='object' || Array.isArray(value)) return null;
 const v=value as Record<string,unknown>;
 if(v.nonce!==context.nonce) return null;
 const keys=Object.keys(v).sort().join(',');
 if(v.type==='ready' && keys==='nonce,type') return v as MapEvent;
 if(v.type==='point_selected' && keys==='nonce,point,type' && isPoint(v.point)) return v as MapEvent;
 if(v.type==='error' && keys==='code,nonce,type' && typeof v.code==='string' && /^[A-Z_]{1,60}$/.test(v.code)) return v as MapEvent;
 return null;
}
