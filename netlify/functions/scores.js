/**
 * Netlify Function: /api/scores
 *
 * GET  → 리더보드 상위 50건 조회
 * POST → 점수 저장 (닉네임·점수 서버 검사 후 INSERT)
 *
 * 환경변수 (Netlify 대시보드 > Site settings > Environment variables):
 *   SUPABASE_URL      : https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY : service_role key  ← anon key가 아닌 service key 사용
 *                          (서버 함수 안에서만 쓰이며 브라우저에 노출되지 않음)
 */

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── 공통 헤더 ────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",          // 같은 Netlify 사이트에서만 호출
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// ── 입력 검사 규칙 (서버 측) ─────────────────────────────────────────────────
const NICKNAME_MAX   = 12;
const NICKNAME_REGEX = /^[^\s<>"';]{1,12}$/;   // 공백·특수문자 차단
const SCORE_MAX      = 9_999_999;               // 현실적 최대 점수

function validateInput(nickname, score) {
  if (typeof nickname !== "string" || nickname.trim().length === 0) {
    return "닉네임을 입력해 주세요.";
  }
  if (nickname.trim().length > NICKNAME_MAX) {
    return `닉네임은 최대 ${NICKNAME_MAX}자까지 입력할 수 있어요.`;
  }
  if (!NICKNAME_REGEX.test(nickname.trim())) {
    return "닉네임에 허용되지 않는 문자가 포함되어 있어요.";
  }
  const numScore = Number(score);
  if (!Number.isInteger(numScore) || numScore < 0) {
    return "점수 값이 올바르지 않아요.";
  }
  if (numScore > SCORE_MAX) {
    return "점수가 허용 범위를 초과했어요.";
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
      ...(options.extraHeaders ?? {}),
    },
  });
  // 응답 본문이 없는 경우(204 No Content) 빈 배열 반환
  const text = await res.text();
  const data = text ? JSON.parse(text) : [];
  return { ok: res.ok, status: res.status, data };
}

// ── 핸들러 ───────────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  // 환경변수 누락 체크
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("환경변수 SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 가 설정되지 않았습니다.");
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "서버 설정 오류입니다. 잠시 후 다시 시도해 주세요." }),
    };
  }

  // ── GET: 리더보드 조회 ────────────────────────────────────────────────────
  if (event.httpMethod === "GET") {
    // 상위 50건 조회 (누락 방지를 위해 limit 명시)
    // Supabase 기본 limit = 1000이지만, 명시적으로 지정해 의도를 고정
    const { ok, data } = await supabaseFetch(
      "/scores?select=nickname,score,created_at&order=score.desc&limit=50",
    );

    if (!ok) {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "리더보드를 불러오지 못했습니다." }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ scores: data }),
    };
  }

  // ── POST: 점수 저장 ───────────────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "요청 형식이 올바르지 않아요." }),
      };
    }

    const { nickname, score } = body;

    // 서버 측 입력 검사
    const validationError = validateInput(nickname, score);
    if (validationError) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: validationError }),
      };
    }

    // Supabase INSERT
    const { ok, data } = await supabaseFetch("/scores", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        nickname: nickname.trim(),
        score:    Number(score),
      }),
    });

    if (!ok) {
      console.error("Supabase INSERT 실패:", data);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "저장에 실패했습니다. 잠시 후 다시 시도해 주세요." }),
      };
    }

    return {
      statusCode: 201,
      headers: CORS_HEADERS,
      body: JSON.stringify({ saved: true }),
    };
  }

  // 허용하지 않은 메서드
  return {
    statusCode: 405,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "허용하지 않는 요청 방식이에요." }),
  };
};
