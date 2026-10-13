# 맥에서 이어서 작업하기

윈도우에서 올린 저장소를 맥에서 받아 시안을 실행하고 계속 작업하는 순서입니다.

## 처음 한 번만
1. 터미널에서 `git --version` 확인 (없으면 맥이 설치를 안내함)
2. 이름과 이메일 등록
   ```
   git config --global user.name "본인이름"
   git config --global user.email "본인이메일"
   ```
3. 저장소는 Private 이라 처음 받을 때 GitHub 로그인이 필요합니다. 브라우저 로그인 창에서 허용하세요. 비밀번호를 요구하면 일반 비밀번호는 안 되고 GitHub 토큰(Personal access token)이나 GitHub Desktop 로그인이 필요합니다.

## 저장소 받기 (clone은 한 번만)
원하는 상위 폴더로 `cd` 한 뒤:
```
git clone https://github.com/govlakdlxl-dev/basketball-matching.git
cd basketball-matching/04_시안_카카오맵
cp config.example.js config.js
```
`config.js` 를 열어 카카오 JavaScript 키를 넣습니다. (이 파일은 `.gitignore` 로 제외돼 git에 올라가지 않습니다.)
```
window.KAKAO_APP_KEY = '카카오 JavaScript 키';
```

## 시안 실행
```
python3 -m http.server 8000
```
브라우저에서 `http://localhost:8000` 을 엽니다. 카카오 개발자 사이트에서 이미 카카오맵 사용 설정 ON, JavaScript SDK 도메인에 `http://localhost:8000` 이 등록돼 있어야 합니다.

## 작업 흐름
- 작업 시작 전: 프로젝트 폴더에서 `git pull`
- 작업 후:
  ```
  git add .
  git status      # config.js 가 목록에 없어야 정상
  git commit -m "무엇을 고쳤는지"
  git push
  ```
- 터미널은 항상 프로젝트 폴더(`basketball-matching`) 안에서 명령을 실행합니다. 두 번째부터는 clone 하지 않고 그 폴더로 `cd` 만 합니다.

## Codex·Claude에게 먼저 읽힐 파일
`README.md`, `01_기획서.md`, `03_화면설계/상세정의.md`. "말로 추천" 탭은 Claude 아티팩트 안에서만 동작하고 로컬 실행에서는 연결되지 않습니다.
