import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const auth = url && key ? createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true } }) : null;
let current: Session | null = null;
const listeners = new Set<() => void>();
const leaving = new Set<(previous:Session)=>Promise<void>>();
export function onSessionLeaving(listener:(previous:Session)=>Promise<void>){leaving.add(listener);return()=>leaving.delete(listener);}
export async function logout(){if(current)await Promise.allSettled([...leaving].map(fn=>fn(current!)));return auth?.auth.signOut();}
export function session() { return current; }
export function onSessionChanged(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export async function initializeSession() {
  if (!auth) return;
  auth.auth.onAuthStateChange((_event, next) => {
    const oldUser = current?.user.id;
    const previous=current;
    current = next;
    if(previous&&oldUser!==next?.user.id)queueMicrotask(()=>{void Promise.allSettled([...leaving].map(fn=>fn(previous)));});
    if (oldUser !== next?.user.id) for (const listener of listeners) listener();
  });
  const { data } = await auth.auth.getSession();
  current = data.session;
  for (const listener of listeners) listener();
}
export async function api<T>(path: string, method = 'GET', input?: unknown): Promise<T> {
  return apiUsingToken<T>(current?.access_token,path,method,input);
}
export async function apiUsingToken<T>(token:string|undefined,path:string,method='GET',input?:unknown):Promise<T>{
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const value = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(value.code || 'CONNECTION_FAILED');
  return value;
}
export function isLocalLoginEnabled() {
  return import.meta.env.DEV && import.meta.env.VITE_ENABLE_LOCAL_LOGIN === 'true' && ['localhost', '127.0.0.1'].includes(location.hostname);
}
