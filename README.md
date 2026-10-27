# 네이버 블로그 자동화 대시보드

키워드를 입력하면 **상위노출 1~5위 분석 → 내 블로그 말투 분석 → Claude가 SEO 글 작성 → 요구사항 자동 재검증(최대 4라운드) → 이미지 → 네이버 SmartEditor에 자동 타이핑해서 임시저장**까지 하는 로컬 전용 도구입니다.
발행은 자동으로 하지 않습니다. 임시저장된 글을 네이버에서 직접 확인하고 발행하세요.

설계 근거와 각 규칙이 막는 버그는 코드 주석에 남겨 두었습니다(`REBUILD_PROMPT.md` 기준).

## 준비 (Windows)

1. Node.js **22.13 이상**(24 LTS 권장), Microsoft Edge(Playwright가 시스템 Edge를 사용 — `npx playwright install` 불필요)
   데이터베이스는 Node 내장 SQLite(`node:sqlite`)를 써서 **Python이나 Visual Studio 빌드 도구가 필요 없습니다.**
   PowerShell에서 `npm`이 "스크립트를 실행할 수 없으므로…"로 막히면 한 번만 실행: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
2. Claude 구독 로그인(토큰 과금 아님):
   ```
   npx @anthropic-ai/claude-code login
   ```
3. 설치 및 환경변수:
   ```
   npm install
   copy .env.example .env.local
   ```
   ⚠ `.env.local`의 `ANTHROPIC_API_KEY`는 **비워두세요.** 값이 있으면 CLI가 구독 로그인 대신 그 키를 쓰려다 매 호출 ~3분씩 재시도 후 실패합니다(구독 로그인이 있으면 코드가 자동으로 무시하긴 합니다).
   이미지용 키(`UNSPLASH_ACCESS_KEY`, `PIXABAY_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`)는 선택입니다.
4. 폰(LAN/Tailscale)에서 접속하려면 `next.config.ts`의 `allowedDevOrigins`에 본인 IP 대역이 들어 있는지 확인하세요.

## 실행

```
npm run dev            # http://localhost:3000
```
- 설정 → 네이버 로그인(PC 화면 로그인 또는 QR 로그인). 로그인한 계정은 계정별 세션 파일로 저장되고, 설정에서 전환할 수 있습니다.
- 대시보드 → 키워드(+상호명, 사진) 입력 → 시작. 진행 상황과 경과 시간이 표시됩니다.
- 초안 화면: 편집 / 미리보기(실제 발행과 같은 8~15자 줄바꿈) / 체크리스트(수정 후 재검사) / 생성 리포트.

### 자동 시작 + 워치독 (선택)

```
powershell -ExecutionPolicy Bypass -File scripts\start-supervisor-hidden.ps1 -Install
```
로그인할 때 `scripts/supervisor.mjs`가 창 없이 실행되어 5초마다 서버를 확인하고, 죽거나 멈추면 다시 띄웁니다.
폰에서 `http://<PC IP>:3001/`을 열면 서버가 꺼져 있어도 "서버 켜기 / 다시 시작"을 누를 수 있습니다(사설 IP에서만 접속 가능).
해제: `-Uninstall`.

## 데이터

모든 런타임 데이터는 `data/`(gitignore)에 있습니다: `app.db`(SQLite), `sessions/naver-storage-state-{blogId}.json`, `style-profiles/`, `media/`, `supervisor.log`.

## 검증

```
npx tsc --noEmit
npx eslint src scripts
npm test               # 순수 함수 회귀 테스트(줄바꿈 불변식 5000문단 + 저장된 초안 전체, 검사/파싱/태그 등)
npm run build
```

실제 계정으로 확인해야 하는 항목(자동 테스트 불가):
1. Claude 로그인 상태에서 사진 없이 짧은 글 하나를 끝까지 실행 → 7분 내외, 리포트에 상위노출/말투/검증 라운드가 채워지는지
2. 사진 첨부 시 사진 다음 첫 문단이 사라지지 않는지, 굵게/밑줄이 문서 끝까지 번지지 않는지(네이버 임시저장 후 눈으로 확인)
3. 상호명만 주고 자료가 부족한 키워드로 실행 → 본문에 지어낸 가격/시간이 없는지
4. 미리보기에서 줄바꿈이 단어 중간에서 끊기지 않고 쉼표에서 끊기는지

> 네이버 DOM 셀렉터는 전부 `src/server/naver/naverSelectors.ts`에 있습니다. 네이버 UI가 바뀌면 이 파일만 고치면 됩니다.
> 하이라이트 끄기는 "같은 노란 스와치를 한 번 더 누르면 해제"로 구현되어 있습니다 — 라이브에서 해제가 안 되면 `publisher.ts`의 `toggleHighlight`를 확인하세요.
