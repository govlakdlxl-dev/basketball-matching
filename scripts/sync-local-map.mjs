import {copyFile,mkdir,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const target=root+'04_시안_카카오맵/';
await mkdir(target+'assets',{recursive:true});
await copyFile(root+'apps/web/dist/map.html',target+'map.html');
await cp(root+'apps/web/dist/assets',target+'assets',{recursive:true});
console.log('기존 localhost:8000 지도 서버에 map.html 동기화 완료. config.js 유지.');
