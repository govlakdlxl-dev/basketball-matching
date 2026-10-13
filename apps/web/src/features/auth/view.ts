import { auth, isLocalLoginEnabled, session } from './session';

export function authView(): HTMLElement {
  const root = document.createElement('section'); root.className = 'card account';
  const notice = document.createElement('p'); notice.className = 'muted'; notice.setAttribute('role', 'status');
  const user = session()?.user;
  if (user) {
    const text = document.createElement('p'); text.textContent = '로그인한 계정에 조건을 저장할 수 있어요.';
    const logout = document.createElement('button'); logout.className = 'btn sec'; logout.textContent = '로그아웃';
    logout.onclick = async () => { logout.disabled = true; const result = await auth?.auth.signOut(); if (result?.error) { notice.textContent = '로그아웃을 다시 시도해 주세요.'; logout.disabled = false; } };
    root.append(text, logout, notice); return root;
  }
  const title = document.createElement('h3'); title.textContent = '내 조건을 어디서든 이어서';
  const kakao = document.createElement('button'); kakao.className = 'btn kakao'; kakao.textContent = '카카오로 로그인'; kakao.disabled = !auth;
  kakao.onclick = async () => {
    kakao.disabled = true;
    const result = await auth?.auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: `${location.origin}/auth/callback` } });
    if (result?.error) { notice.textContent = '카카오 로그인 연결을 확인하고 다시 시도해 주세요.'; kakao.disabled = false; }
  };
  root.append(title, kakao, notice);
  if (!auth) notice.textContent = '로그인을 준비하고 있어요. 조건은 이 기기에서 먼저 설정할 수 있어요.';
  if (isLocalLoginEnabled()) {
    const details = document.createElement('details'); details.open = true; details.className = 'local-test';
    const summary = document.createElement('summary'); summary.textContent = '개발용 테스트 계정';
    const form = document.createElement('form'); form.className = 'stack';
    const emailLabel = document.createElement('label'); emailLabel.textContent = '테스트 이메일';
    const email = document.createElement('input'); email.type = 'email'; email.required = true; email.autocomplete = 'off'; emailLabel.append(email);
    const passwordLabel = document.createElement('label'); passwordLabel.textContent = '테스트 비밀번호';
    const password = document.createElement('input'); password.type = 'password'; password.required = true; password.autocomplete = 'off'; passwordLabel.append(password);
    const submit = document.createElement('button'); submit.className = 'btn sec'; submit.textContent = '테스트 계정 로그인';
    form.append(emailLabel, passwordLabel, submit);
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true; notice.textContent = '로그인 중…';
      const result = await auth?.auth.signInWithPassword({ email: email.value, password: password.value });
      if (result?.error) { notice.textContent = '테스트 계정 정보를 확인해 주세요.'; submit.disabled = false; }
    };
    details.append(summary, form); root.append(details);
  }
  return root;
}
