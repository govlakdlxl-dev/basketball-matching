import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let value;
try {value=JSON.parse(execFileSync('pnpm',['exec','supabase','status','-o','json'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
catch {throw new Error('로컬 Supabase를 먼저 시작한 후 다시 실행해 주세요.');}
for(const key of ['API_URL','DB_URL']) if(!['localhost','127.0.0.1'].includes(new URL(value[key]).hostname)) throw new Error('로컬 환경만 설정할 수 있습니다.');
await writeFile(root+'.env.test.json',JSON.stringify(value),{mode:0o600});
async function settings(path,entries) {
 let text='';try {text=await readFile(root+path,'utf8');} catch {}
 for(const [key,val] of Object.entries(entries)) {const pattern=new RegExp(`^${key}=.*$`,'m');text=pattern.test(text)?text.replace(pattern,`${key}=${val}`):text+`\n${key}=${val}\n`;}
 await writeFile(root+path,text,{mode:0o600});
}
await settings('apps/web/.env.local',{VITE_API_BASE_URL:'/api',VITE_SUPABASE_URL:value.API_URL,VITE_SUPABASE_PUBLISHABLE_KEY:value.ANON_KEY,VITE_MAP_ORIGIN:'http://localhost:8000',VITE_MAP_PARENT_ORIGINS:'http://127.0.0.1:5173,http://localhost:5173',VITE_ENABLE_LOCAL_LOGIN:'true'});
await settings('apps/server/.dev.vars',{SUPABASE_URL:value.API_URL,SUPABASE_SERVICE_ROLE_KEY:value.SERVICE_ROLE_KEY,ALLOWED_ORIGINS:'http://127.0.0.1:5173,http://localhost:5173,http://localhost:8000,capacitor://localhost,https://localhost'});
console.log('로컬 검증 설정을 Git 제외 파일에 저장했습니다. 기존 카카오 지도 config.js는 유지합니다.');
