/**
 * Netlify Function: /api/guestbook
 *
 * GET  → 방명록 글 목록을 최신순으로 조회 (상위 100건)
 * POST → 방명록 글 저장 (닉네임·내용 서버 검사 후 INSERT)
 *
 * 브라우저는 Supabase 에 직접 접근하지 않습니다.
 * 반드시 이 서버 함수를 거쳐서만 저장·조회합니다.
 *
 * ── 필요한 환경 변수 (Netlify 대시보드 > Site settings > Environment variables) ──
 *   SUPABASE_URL          : https://xxxx.supabase.co  (프로젝트 URL)
 *   SUPABASE_SERVICE_KEY  : service_role 키
 *                           (서버 함수 안에서만 쓰이며 브라우저로 전송되지 않음)
 */

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── 공통 응답 헤더 ───────────────────────────────────────────────────────────
const HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// ── 입력 검사 규칙 (서버 측) ─────────────────────────────────────────────────
const NICKNAME_MAX = 20;    // 닉네임 최대 길이
const MESSAGE_MAX  = 500;   // 방명록 내용 최대 길이

function validateInput(nickname, message) {
  // 닉네임 검사
  if (typeof nickname !== "string" || nickname.trim().length === 0) {
    return "닉네임을 입력해 주세요.";
  }
  if (nickname.trim().length > NICKNAME_MAX) {
    return `닉네임은 최대 ${NICKNAME_MAX}자까지 입력할 수 있어요.`;
  }
  // 내용 검사
  if (typeof message !== "string" || message.trim().length === 0) {
    return "방명록 내용을 입력해 주세요.";
  }
  if (message.trim().length > MESSAGE_MAX) {
    return `내용은 최대 ${MESSAGE_MAX}자까지 입력할 수 있어요.`;
  }
  return null; // 오류 없음
}

// ── Supabase REST API 헬퍼 ───────────────────────────────────────────────────
async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey":        SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type":  "application/json",
      "Prefer":        options.prefer ?? "",
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : [];
  return { ok: res.ok, status: res.status, data };
}

// ── 핸들러 ───────────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  // CORS preflight 요청 처리
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }

  // 환경 변수 누락 확인
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("환경 변수 SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 가 설정되지 않았습니다.");
    return {
      statusCode: 503,
      headers: HEADERS,
      body: JSON.stringify({ error: "서버 설정 오류입니다. 잠시 후 다시 시도해 주세요." }),
    };
  }

  // ── GET: 방명록 목록 조회 (최신순) ────────────────────────────────────────
  if (event.httpMethod === "GET") {
    // created_at 내림차순 = 최신 글이 위로. 상위 100건 조회.
    const { ok, data } = await supabaseFetch(
      "/guestbook_entries?select=nickname,message,created_at&order=created_at.desc&limit=100",
    );

    if (!ok) {
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({ error: "방명록을 불러오지 못했습니다." }),
      };
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ entries: data }),
    };
  }

  // ── POST: 방명록 글 저장 ──────────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({ error: "요청 형식이 올바르지 않아요." }),
      };
    }

    const { nickname, message } = body;

    // 서버 측 입력 검사 (빈값·길이 초과 거절)
    const validationError = validateInput(nickname, message);
    if (validationError) {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({ error: validationError }),
      };
    }

    // Supabase 에 INSERT
    const { ok, data } = await supabaseFetch("/guestbook_entries", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        nickname: nickname.trim(),
        message:  message.trim(),
      }),
    });

    if (!ok) {
      console.error("Supabase INSERT 실패:", data);
      return {
        statusCode: 502,
        headers: HEADERS,
        body: JSON.stringify({ error: "저장에 실패했습니다. 잠시 후 다시 시도해 주세요." }),
      };
    }

    return {
      statusCode: 201,
      headers: HEADERS,
      body: JSON.stringify({ saved: true }),
    };
  }

  // 허용하지 않은 메서드
  return {
    statusCode: 405,
    headers: HEADERS,
    body: JSON.stringify({ error: "허용하지 않는 요청 방식이에요." }),
  };
};
