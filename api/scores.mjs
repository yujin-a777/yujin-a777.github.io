/**
 * Vercel Serverless Function: /api/scores
 *
 * GET  → 리더보드 상위 50건 조회 (score 내림차순)
 * POST → 점수 저장 (닉네임·점수 서버 검사 후 INSERT)
 *
 * 브라우저는 Supabase 에 직접 접근하지 않습니다. 이 서버 함수를 거쳐서만 저장·조회합니다.
 *
 * Vercel 은 api/ 폴더의 파일을 자동으로 /api/<파일명> 경로에 매핑합니다.
 * (이 파일: api/scores.mjs → /api/scores)
 *
 * ── 필요한 환경 변수 (Vercel 대시보드 > Project Settings > Environment Variables) ──
 *   SUPABASE_URL          : https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  : service_role 키 (서버 함수 안에서만 사용, 브라우저로 미전송)
 */

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Supabase 인증 헤더 ───────────────────────────────────────────────────────
// 신형 키(sb_secret_/sb_publishable_)는 apikey 헤더로만 전송해야 한다.
// 레거시 JWT(eyJ...)는 apikey + Authorization: Bearer 둘 다 허용.
function supabaseAuthHeaders() {
  const key = SUPABASE_SERVICE_KEY || "";
  const isNewFormat = key.startsWith("sb_secret_") || key.startsWith("sb_publishable_");
  const headers = { "apikey": key };
  if (!isNewFormat) {
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

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

// ── 응답 본문을 안전하게 JSON 으로 파싱 ──────────────────────────────────────
function safeParseJson(text) {
  if (!text) return { ok: true, value: [] };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    const preview = text.slice(0, 120).replace(/\s+/g, " ");
    console.error(
      "Supabase 응답이 JSON 이 아닙니다. SUPABASE_URL 설정을 확인하세요. 응답 미리보기:",
      preview,
    );
    return { ok: false, value: null };
  }
}

// ── Supabase REST API 헬퍼 ───────────────────────────────────────────────────
async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      ...supabaseAuthHeaders(),
      "Content-Type":  "application/json",
      "Prefer":        options.prefer ?? "",
    },
  });
  const text = await res.text();
  const parsed = safeParseJson(text);
  if (!parsed.ok) {
    return { ok: false, status: res.status || 502, data: null, parseError: true };
  }
  return { ok: res.ok, status: res.status, data: parsed.value };
}

// ── 공통 응답 헬퍼 (Vercel res 객체) ─────────────────────────────────────────
function sendJson(res, statusCode, obj) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(obj));
}

// ── Vercel 서버 함수 핸들러 ──────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  // 환경 변수 누락 확인
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("환경 변수 SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 가 설정되지 않았습니다.");
    sendJson(res, 503, { error: "서버 설정 오류입니다. 잠시 후 다시 시도해 주세요." });
    return;
  }

  // ── GET: 리더보드 조회 (상위 50건) ───────────────────────────────────────
  if (req.method === "GET") {
    const { ok, data, parseError } = await supabaseFetch(
      "/scores?select=nickname,score,created_at&order=score.desc&limit=50",
    );

    if (!ok) {
      const message = parseError
        ? "서버 설정 오류입니다. 관리자에게 문의해 주세요."
        : "리더보드를 불러오지 못했습니다.";
      sendJson(res, parseError ? 503 : 502, { error: message });
      return;
    }

    sendJson(res, 200, { scores: data });
    return;
  }

  // ── POST: 점수 저장 ──────────────────────────────────────────────────────
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        sendJson(res, 400, { error: "요청 형식이 올바르지 않아요." });
        return;
      }
    }
    if (body == null || typeof body !== "object") {
      sendJson(res, 400, { error: "요청 형식이 올바르지 않아요." });
      return;
    }

    const { nickname, score } = body;

    const validationError = validateInput(nickname, score);
    if (validationError) {
      sendJson(res, 400, { error: validationError });
      return;
    }

    const { ok, data, parseError } = await supabaseFetch("/scores", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        nickname: nickname.trim(),
        score:    Number(score),
      }),
    });

    if (!ok) {
      if (parseError) {
        sendJson(res, 503, { error: "서버 설정 오류입니다. 관리자에게 문의해 주세요." });
        return;
      }
      console.error("Supabase INSERT 실패:", data);
      sendJson(res, 502, { error: "저장에 실패했습니다. 잠시 후 다시 시도해 주세요." });
      return;
    }

    sendJson(res, 201, { saved: true });
    return;
  }

  // 허용하지 않은 메서드
  sendJson(res, 405, { error: "허용하지 않는 요청 방식이에요." });
}
