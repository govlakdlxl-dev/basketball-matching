import './styles/theme.css';
import './styles/layout.css';
import { mountRouter } from './app/router';
import {createPlatform} from './platform/runtime';
import {setupWebPush} from './features/notifications/web-push';
import {handleAppReturn} from './features/auth/callback';
import {subscribeToAppState} from '@basket/mobile';
import {refreshSession} from './features/auth/session';
import {setupNativePush,refreshNativePush} from './features/notifications/native-push';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('APP_ROOT_MISSING');
setupWebPush();setupNativePush();mountRouter(app);
const platform=createPlatform();
if(platform.kind!=='web'){
 void platform.subscribeToLinks(url=>{void handleAppReturn(url).catch(()=>{const target=document.querySelector('#connection');if(target)target.textContent='복귀 연결을 확인하지 못했어요. 다시 로그인하거나 참여 내역을 확인해 주세요.';});});
 void subscribeToAppState(active=>{if(active){void refreshSession();void refreshNativePush().catch(()=>{});}});
}
// 설치 앱에서도 공식 안내·길찾기는 플랫폼의 외부 브라우저로 엽니다.
if(platform.kind!=='web') app.addEventListener('click',event=>{
  const link=(event.target as Element).closest<HTMLAnchorElement>('a[target="_blank"]');
  if(!link) return;event.preventDefault();void platform.openExternal(link.href);
});
