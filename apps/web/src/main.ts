import './styles/theme.css';
import './styles/layout.css';
import { mountRouter } from './app/router';
import {createPlatform} from './platform/runtime';
import {setupWebPush} from './features/notifications/web-push';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('APP_ROOT_MISSING');
setupWebPush();mountRouter(app);
const platform=createPlatform();
// 설치 앱에서도 공식 안내·길찾기는 플랫폼의 외부 브라우저로 엽니다.
if(platform.kind!=='web') app.addEventListener('click',event=>{
  const link=(event.target as Element).closest<HTMLAnchorElement>('a[target="_blank"]');
  if(!link) return;event.preventDefault();void platform.openExternal(link.href);
});
