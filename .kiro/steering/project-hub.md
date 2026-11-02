# 프로젝트 허브 — 장유진 (2026 가을 유레카 프로젝트)

## 프로젝트 개요
- **소속**: 국민대학교 경영정보학부
- **학생**: 장유진 (yujinchangishere@kookmin.ac.kr)
- **GitHub Pages**: https://yujin-a777.github.io/
- **GitHub 저장소**: https://github.com/yujin-a777/yujin-a777.github.io
- **과목**: 2026년 가을 유레카 프로젝트

## 현재 파일 구조
- `index.html` — 자기소개 홈페이지 (Pretendard 폰트, 벤토 그리드 레이아웃)
- `pacman.html` — Pacman 게임 (이전 스프린트에서 생성)
- `galaga-index.html` — Galaga 게임 (신규 기획 중)

## 기술 스택 결정

### 배포: Netlify 선택 (Vercel 대비 우위)
Galaga 게임 프로젝트 특성상 Netlify가 더 적합하다고 결론 내림.

**근거:**
- Vercel은 Next.js/React 서버사이드 프레임워크에 최적화 → 순수 정적 HTML 게임에는 과도함
- Netlify는 정적 사이트 + serverless functions 조합이 게임 백엔드(점수 저장 API)에 적합
- Netlify Functions (AWS Lambda 기반)으로 간단한 API 엔드포인트 구성 가능
- GitHub Pages와 달리 환경변수, 리디렉션 규칙, 폼 처리 지원
- 무료 플랜: 빌드 300분/월, 대역폭 100GB/월 → 학생 프로젝트에 충분

### 백엔드/DB: Supabase 선택
- **인증**: Supabase Auth (Google, GitHub OAuth 지원)
- **데이터베이스**: PostgreSQL (점수 저장, 사용자 프로필)
- **실시간**: Supabase Realtime → 멀티플레이/리더보드 실시간 업데이트
- **무료 플랜**: 500MB DB, 50,000 MAU → 학생 프로젝트에 충분

### 최종 스택: Netlify + Supabase
```
galaga-index.html (프론트엔드)
    ↓ HTTP/WebSocket
Supabase (Auth + PostgreSQL + Realtime)
    ↓ 배포
Netlify (정적 호스팅 + Functions)
```

## Galaga 게임 기능 로드맵

### Phase 1 — 기본 게임 (현재)
- [ ] galaga-index.html 기본 게임플레이 구현
- [ ] 점수 시스템

### Phase 2 — 소셜 기능
- [ ] Supabase Auth 로그인 (Google OAuth)
- [ ] 점수 저장 (PostgreSQL)
- [ ] 전체 리더보드

### Phase 3 — 멀티플레이
- [ ] Supabase Realtime으로 실시간 랭킹
- [ ] 방 생성 / 친구 초대
- [ ] 스펙터이터 모드

## Notion 허브 페이지
- 기존 허브 (이전 세션): https://app.notion.com/p/40b1fe9e3e03811099e6f9f2e6b0a945
- 유레카 프로젝트 기획 페이지: https://app.notion.com/p/40c1fe9e3e0381e2aeacc5ad811f2038

## 참고: 이전 세션 히스토리
- **이전 세션 (2026-11-01)**: index.html 자기소개 페이지 완성, pacman.html 생성, Notion MCP 연결
- **이번 세션 (2026-11-02)**: Vercel vs Netlify 분석, galaga 게임 기술 스택 결정, 유레카 프로젝트 기획 수립
