# Feature Plan — 방명록 (Option G1: 자유 입력 방명록) 〔최소 완성 버전〕

> 작성일: 2026-11-07
> 프로젝트: 2026 가을 유레카 프로젝트 (국민대학교 경영정보학부 장유진)
> 선택 옵션: **Option G1 — 자유 입력 방명록 (로그인 없음), 현재 구현 그대로 명세화 + RLS 확정**
> 배포 플랫폼: Netlify
> 백엔드: Supabase (PostgreSQL + RLS)
>
> ℹ️ 이 문서는 두 기능 계획을 함께 담고 있습니다.
> - 상단: **방명록 (G1)** — 이번에 확정한 최소 완성 기능
> - 하단: **Galaga 게임 (Option A)** — 이전 기획, 보존됨

---

## G1-1. 관련 파일 (현재 구현 기준, 모두 존재 확인됨)

| 파일 | 역할 |
|------|------|
| `guestbook.html` | 방명록 화면 (폼 + 목록), `/api/guestbook` 호출, 출력은 `textContent`로 XSS 차단 |
| `netlify/functions/guestbook.js` | 서버 함수 (GET 목록·POST 저장), 서버 측 입력 검증, Supabase REST 호출 |
| `netlify.toml` | `/api/guestbook` → `/.netlify/functions/guestbook` 리다이렉트, 보안 헤더 |
| `index.html` | 내비게이션에 "방명록" 링크 연결됨 |

> **원칙**: 새 프레임워크·새 의존성 없음. 기존 정적 HTML + Netlify Function 구조 그대로 사용.

---

## G1-2. 화면 구성 및 UI 요소

### 작성 폼

| 요소 | 종류 | 동작 |
|------|------|------|
| 닉네임 입력란 | `<input type="text" maxlength="20">` | 글자 수 카운터 0/20 |
| 내용 입력란 | `<textarea maxlength="500">` | 글자 수 카운터 0/500 |
| "남기기" 버튼 | `<button>` | 닉네임·내용이 모두 비어있지 않을 때만 활성화 |
| 상태 메시지 | `<span role="status" aria-live="polite">` | 저장 중 / 성공 / 실패 표시 |

### 글 목록

| 요소 | 종류 | 동작 |
|------|------|------|
| 목록 | `<ul>` 카드 리스트 | 최신순(`created_at` 내림차순) 표시 |
| 항목 | 닉네임 + 작성일시 + 내용 | 닉네임·내용은 `textContent`로 출력 (XSS 차단) |
| 로드 상태 | `<li>` | "불러오는 중…" / "아직 글이 없어요" / 오류 메시지 |

---

## G1-3. 저장할 항목 (Supabase 테이블: `guestbook_entries`)

```sql
create table guestbook_entries (
  id          uuid primary key default gen_random_uuid(),
  nickname    text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);
```

---

## G1-4. Supabase 저장·조회 설계 (브라우저는 Supabase에 직접 접근하지 않음)

```
guestbook.html (브라우저)
    ↓ fetch /api/guestbook  (같은 사이트)
netlify.toml redirect
    ↓
netlify/functions/guestbook.js  (SUPABASE_SERVICE_KEY 사용, 서버 전용)
    ↓ REST  /rest/v1/guestbook_entries
Supabase (PostgreSQL + RLS)
```

- 조회(GET): `select=nickname,message,created_at&order=created_at.desc&limit=100`
- 저장(POST): `nickname`, `message` INSERT (서버에서 `trim()` 후 저장)

### RLS 정책 (G1 확정 — service key만 통과, anon 직접 접근 차단)

```sql
alter table guestbook_entries enable row level security;
-- anon·authenticated 역할에는 정책을 부여하지 않음 → 브라우저의 직접 접근 차단.
-- 서버 함수는 service_role 키로 접근하므로 RLS를 우회한다(설계상 의도).
```

---

## G1-5. 성공 / 실패 동작 명세

### 저장 성공
1. POST → 서버 검증 통과 → Supabase INSERT (201)
2. "글이 등록됐어요! 🎉" 표시
3. 입력란 비움, 목록 재조회·갱신

### 저장 실패
- 입력 검증 실패(400): 서버 메시지 그대로 표시, 성공처럼 보이지 않음, 버튼 재활성화
- 서버·네트워크 오류(502/503): "저장에 실패했습니다. 잠시 후 다시 시도해 주세요." 표시, 버튼 재활성화

### 목록 조회 실패
- "방명록을 불러올 수 없습니다" 표시, 작성 폼은 정상 사용 가능

---

## G1-6. 접근 제한 설계 (자유 입력 = 로그인 없음)

| 위협 | 대응 | 상태 |
|------|------|------|
| service key 노출 | Netlify 환경변수(`SUPABASE_SERVICE_KEY`)로만 관리, 브라우저로 전송 안 함 | ✅ 구현됨 |
| 브라우저의 Supabase 직접 조작 | 모든 접근을 Netlify Function 경유로 강제 + RLS로 anon 직접 접근 차단 | ⬜ RLS 적용 필요 |
| 빈값·과도한 길이 | 서버 측 검증 (닉네임 1~20자, 내용 1~500자) | ✅ 구현됨 |
| XSS | 출력 시 `textContent` 사용 | ✅ 구현됨 |
| 스팸 INSERT | 무료 플랜 기본 rate limit (추후 제출 간격 제한 권장) | ⬜ 추후 |

---

## G1-7. 검사 방법 (Acceptance Criteria)

### AC-G1. 입력 검증
- [ ] 닉네임·내용 중 하나라도 비어 있으면 "남기기" 버튼이 비활성화된다
- [ ] 닉네임 21자 이상 / 내용 501자 이상은 서버가 400으로 거절한다
- [ ] 공백만 입력 시 `trim()` 후 빈값으로 거절된다

### AC-G2. 저장
- [ ] POST 성공 시 `guestbook_entries`에 행이 추가된다
- [ ] 저장된 닉네임·내용이 입력값과 일치한다
- [ ] "글이 등록됐어요!" 메시지가 표시된다

### AC-G3. 목록
- [ ] 페이지 로드 시 최신순으로 글이 표시된다
- [ ] 저장 성공 후 목록이 자동 갱신된다
- [ ] 조회 실패 시 오류 메시지가 표시되고 폼은 정상 동작한다

### AC-G4. 보안·격리
- [ ] 브라우저 번들·공개 출력에 service key가 포함되지 않는다
- [ ] 서버 함수(`netlify/functions/`)가 공개 publish 출력(`.`)에 복사되지 않는다
- [ ] 닉네임에 `<script>` 입력 시 화면에 실행되지 않고 문자 그대로 표시된다

### AC-G5. 기존 자산 보존
- [ ] `index.html`·`pacman.html`·`galaga-index.html`이 기존과 동일하게 동작한다
- [ ] GitHub Pages 설정이 변경되지 않는다

---

## G1-8. 배포 준비 (Netlify) — 현재 상태

- 빌드 도구·프레임워크 없음(순수 정적). Node v24.22.1 / npm 11.19.1 확인됨.
- `netlify.toml`: `publish = "."`, `command = ""`, `functions = "netlify/functions"`
- `.netlifyignore`로 `.kiro/`, `docs/`, `.env*`, `node_modules/` 등 공개 제외
- 서버 함수는 `netlify/functions/`에만 두고 publish 루트(`.`)에 복사하지 않음

> **현재 상태**: 명세 확정(G1). 구현은 대부분 완료, RLS 적용 및 배포 설정만 남음. 커밋·push 미수행.

---
---

# Feature Plan — Galaga 게임 (Option A: 닉네임 + 점수 저장) 〔이전 기획, 보존〕

> 작성일: 2026-11-02  
> 프로젝트: 2026 가을 유레카 프로젝트 (국민대학교 경영정보학부 장유진)  
> 선택 옵션: **Option A — 닉네임 입력 + 점수 저장 + 리더보드**  
> 배포 플랫폼: Netlify  
> 백엔드: Supabase (PostgreSQL + RLS)

---

## 1. 화면 구성 및 UI 요소

### 1-1. 시작 화면 (게임 전)

| 요소 | 종류 | 동작 |
|------|------|------|
| 닉네임 입력창 | `<input type="text">` | 최대 12자, placeholder "닉네임 입력" |
| 유효성 메시지 | `<span>` | 빈값·초과·특수문자 입력 시 빨간 텍스트 표시 |
| "게임 시작" 버튼 | `<button>` | 유효성 통과 시에만 활성화, 클릭 시 게임 진입 |
| 리더보드 미리보기 | `<ol>` 목록 | 상위 10명 닉네임 + 점수 + 날짜 표시 (페이지 로드 시 조회) |

### 1-2. 게임 화면 (플레이 중)

| 요소 | 종류 | 동작 |
|------|------|------|
| 게임 Canvas | `<canvas>` | Galaga 게임 렌더링 |
| 점수 HUD | `<div>` | 현재 점수 실시간 표시 |
| 닉네임 표시 | `<div>` | 입력한 닉네임 우상단 표시 |

### 1-3. 게임 오버 화면

| 요소 종류 | 동작 |
|------|------|
| 최종 점수 표시 | 큰 텍스트로 점수 강조 |
| 저장 상태 메시지 | "저장됐어요! 🎉" 또는 "저장 실패 — 점수: N점" |
| 리더보드 갱신 | 저장 성공 시 리더보드 자동 새로고침 |
| "다시 하기" 버튼 | 닉네임 유지, 게임만 재시작 |
| "닉네임 변경" 버튼 | 시작 화면으로 돌아감 |

---

## 2. Supabase 데이터 설계

### 2-1. 테이블: `scores`

```sql
create table scores (
  id          uuid primary key default gen_random_uuid(),
  nickname    text not null,
  score       integer not null,
  created_at  timestamptz not null default now()
);
```

### 2-2. Row-Level Security (RLS) 정책

```sql
-- RLS 활성화
alter table scores enable row level security;

-- 누구나 조회 가능 (리더보드)
create policy "anyone can read scores"
  on scores for select using (true);

-- 누구나 삽입 가능 (로그인 불필요)
create policy "anyone can insert scores"
  on scores for insert with check (
    length(nickname) >= 1 and
    length(nickname) <= 12
  );

-- 수정·삭제 불가 (정책 없음 = 차단)
```

### 2-3. 리더보드 조회 쿼리

```sql
select nickname, score, created_at
from scores
order by score desc
limit 10;
```

---

## 3. 클라이언트 유효성 검사

| 조건 | 처리 |
|------|------|
| 닉네임 빈값 | "닉네임을 입력해 주세요" 메시지, 시작 버튼 비활성 |
| 12자 초과 | "최대 12자까지 입력할 수 있어요" 메시지 |
| 특수문자 포함 (`<`, `>`, `"`, `'`, `;`) | "특수문자는 사용할 수 없어요" 메시지 |
| 공백만 입력 | 빈값과 동일하게 처리 (`trim()` 적용) |

---

## 4. 성공 / 실패 동작 명세

### 4-1. 점수 저장 성공

1. 게임 오버 발생
2. Supabase `scores` 테이블에 INSERT
3. "저장됐어요! 🎉" 메시지 표시 (2초 후 자동 숨김)
4. 리더보드 재조회 및 화면 갱신
5. "다시 하기" / "닉네임 변경" 버튼 표시

### 4-2. 점수 저장 실패 (네트워크 오류 등)

1. 게임 오버 발생
2. INSERT 실패 (catch)
3. "저장에 실패했습니다. 점수: N점 (스크린샷으로 기록해 두세요)" 메시지 표시
4. 리더보드는 기존 데이터 유지
5. 게임 계속 진행 가능 (기능 차단 없음)

### 4-3. 리더보드 로드 실패

1. "리더보드를 불러올 수 없습니다" 메시지 표시
2. 게임 시작은 정상 진행 가능

---

## 5. 접근 제한 설계

| 위협 | 대응 |
|------|------|
| 허위 고점수 직접 INSERT | Supabase RLS의 `with check` 조건으로 닉네임 길이 서버 측 재검증 |
| XSS (닉네임에 스크립트 삽입) | 클라이언트 특수문자 차단 + Supabase JS SDK가 파라미터 바인딩 처리 |
| 대량 스팸 INSERT | Supabase 무료 플랜 기본 rate limit 적용 (추후 Edge Function으로 강화 가능) |
| anon key 노출 | Netlify 환경변수(`SUPABASE_URL`, `SUPABASE_ANON_KEY`)로 관리, 코드에 직접 삽입 금지 |

> **참고**: Supabase anon key는 공개 읽기 전용 작업에 설계된 키입니다.  
> RLS를 올바르게 설정하면 anon key가 노출되어도 데이터 무결성이 유지됩니다.

---

## 6. 파일 구조 (구현 후 예상)

```
yujin-a777.github.io/
├── index.html              # 자기소개 홈페이지 (기존 유지)
├── pacman.html             # Pacman 게임 (기존 유지)
├── galaga-index.html       # Galaga 게임 (신규 구현 예정)
├── netlify.toml            # Netlify 배포 설정 (신규)
├── docs/
│   └── feature-plan.md     # 이 파일
└── .kiro/
    ├── settings/mcp.json
    └── steering/project-hub.md
```

---

## 7. 검사 방법 (Acceptance Criteria)

### AC-1. 닉네임 유효성

- [ ] 빈값으로 시작 버튼 클릭 시 에러 메시지가 표시되고 게임이 시작되지 않는다
- [ ] 13자 이상 입력 시 에러 메시지가 표시된다
- [ ] `<script>` 등 특수문자 포함 시 에러 메시지가 표시된다
- [ ] 공백만 입력 후 시작 시 에러 메시지가 표시된다

### AC-2. 점수 저장

- [ ] 게임 오버 후 Supabase `scores` 테이블에 행이 추가된다
- [ ] 저장된 닉네임이 입력값과 일치한다
- [ ] 저장된 점수가 게임 내 표시 점수와 일치한다
- [ ] "저장됐어요!" 메시지가 표시된다

### AC-3. 리더보드

- [ ] 페이지 로드 시 최대 10명의 순위가 점수 내림차순으로 표시된다
- [ ] 새 점수 저장 후 리더보드가 자동으로 갱신된다
- [ ] 조회 실패 시 에러 메시지가 표시되고 게임은 정상 동작한다

### AC-4. 기존 파일 영향 없음

- [ ] `index.html` 페이지가 기존과 동일하게 동작한다
- [ ] `pacman.html` 게임이 기존과 동일하게 동작한다

### AC-5. 배포

- [ ] Netlify에 push 후 자동 배포가 완료된다
- [ ] 배포된 URL에서 리더보드 조회가 정상 동작한다
- [ ] 배포된 URL에서 점수 저장이 정상 동작한다

---

## 8. 구현 순서 (예정)

1. Supabase 프로젝트 생성 → `scores` 테이블 + RLS 설정
2. `galaga-index.html` — 시작 화면 + 닉네임 입력 구현
3. `galaga-index.html` — Galaga 게임 로직 구현 (pacman.html 패턴 참고)
4. `galaga-index.html` — 게임 오버 시 Supabase INSERT 연동
5. `galaga-index.html` — 리더보드 SELECT 연동
6. `netlify.toml` 작성 + Netlify 환경변수 설정
7. AC 항목별 검사 실행

> **현재 상태**: 명세 확정 완료. 구현 미시작.
