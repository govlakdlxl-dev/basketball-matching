import './styles/theme.css';
import './styles/layout.css';
import { mountRouter } from './app/router';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('APP_ROOT_MISSING');
mountRouter(app);
