/**
 * Vercel Serverless Function: /api/guestbook
 *
 * GET  → 방명록 글 목록을 최신순으로 조회 (페이지네이션으로 전체 조회, 누락 없음)
 * POST → 방명록 글 저장 (닉네임·내용 서버 검사 후 INSERT)
 *
 * 브라우저는 Supabase 에 직접 접근하지 않습니다.
 * 반드시 이 서버 함수를 거쳐서만 저장·조회합니다.
 *
 * Vercel 은 api/ 폴더의 파일을 자동으로 /api/<파일명> 경로에 매핑합니다.
 * 즉 이 파일(api/guestbook.js)은 별도 설정 없이 /api/guestbook 으로 동작합니다.
 *
 * ── 필요한 환경 변수 (Vercel 대시보드 > Project Settings > Environment Variables) ──
 *   SUPABASE_URL          : https://xxxx.supabase.co  (프로젝트 URL)
 *   SUPABASE_SERVICE_KEY  : service_role 키
 *                           (서버 함수 안에서만 쓰이며 브라우저로 전송되지 않음)
 */

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Supabase 인증 헤더 ───────────────────────────────────────────────────────
// Supabase 키는 두 가지 형식이 있다.
//   1) 신형: sb_secret_... / sb_publishable_...  → apikey 헤더로만 보내야 한다.
//      이 키를 Authorization: Bearer 로 보내면 PostgREST 가 JWT 로 파싱하려다
//      실패해 401 "Invalid API key" 가 난다.
//   2) 레거시 JWT(eyJ...): apikey 와 Authorization: Bearer 둘 다 허용.
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
const NICKNAME_MAX = 20;    // 닉네임 최대 길이
const MESSAGE_MAX  = 500;   // 방명록 내용 최대 길이

// 허용하지 않는 제어 문자(개행·탭 제외). 닉네임에는 개행·탭도 불허.
const CONTROL_CHARS_ALL   = /[\u0000-\u001F\u007F]/;          // 모든 제어문자
const CONTROL_CHARS_NO_WS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // 개행·탭·CR은 허용

function validateInput(nickname, message) {
  // ── 닉네임 검사 ──
  if (typeof nickname !== "string") {
    return "닉네임 형식이 올바르지 않아요.";
  }
  const nick = nickname.trim();
  if (nick.length === 0) {
    return "닉네임을 입력해 주세요.";
  }
  if (nick.length > NICKNAME_MAX) {
    return `닉네임은 최대 ${NICKNAME_MAX}자까지 입력할 수 있어요.`;
  }
  if (CONTROL_CHARS_ALL.test(nick)) {
    return "닉네임에 허용되지 않는 문자가 포함되어 있어요.";
  }

  // ── 내용 검사 ──
  if (typeof message !== "string") {
    return "내용 형식이 올바르지 않아요.";
  }
  const msg = message.trim();
  if (msg.length === 0) {
    return "방명록 내용을 입력해 주세요.";
  }
  if (msg.length > MESSAGE_MAX) {
    return `내용은 최대 ${MESSAGE_MAX}자까지 입력할 수 있어요.`;
  }
  if (CONTROL_CHARS_NO_WS.test(msg)) {
    return "내용에 허용되지 않는 문자가 포함되어 있어요.";
  }

  return null; // 오류 없음
}

// ── 응답 본문을 안전하게 JSON 으로 파싱 ──────────────────────────────────────
// 잘못된 SUPABASE_URL 등으로 HTML 이 돌아오면 JSON.parse 가 크래시하므로 잡아준다.
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

// ── 전체 행 페이지네이션 조회 ────────────────────────────────────────────────
// PostgREST(Supabase REST)는 한 응답의 행 수에 상한(기본 1000)이 있어
// Range 헤더로 페이지를 넘기며 모두 모은다. (조회 건수 제한 누락 방지)
async function supabaseFetchAll(basePath, pageSize = 1000, hardCap = 100000) {
  let from = 0;
  const all = [];

  while (from < hardCap) {
    const to = from + pageSize - 1;
    const res = await fetch(`${SUPABASE_URL}/rest/v1${basePath}`, {
      headers: {
        ...supabaseAuthHeaders(),
        "Content-Type":  "application/json",
        "Range-Unit":    "items",
        "Range":         `${from}-${to}`,
        "Prefer":        "count=exact",
      },
    });

    if (!res.ok && res.status !== 206) {
      // Supabase 가 에러를 돌려준 경우(테이블 없음·RLS·인증 등). 상세는 서버 로그로만.
      const errText = await res.text();
      console.error("Supabase 조회 실패:", res.status, errText.slice(0, 300));
      return { ok: false, status: res.status, data: all };
    }

    const text = await res.text();
    const parsed = safeParseJson(text);
    if (!parsed.ok) {
      return { ok: false, status: res.status || 502, data: all, parseError: true };
    }
    const page = Array.isArray(parsed.value) ? parsed.value : [];
    all.push(...page);

    const contentRange = res.headers.get("content-range") || "";
    const total = Number((contentRange.split("/")[1] || "").trim());

    if (page.length < pageSize) break;
    if (Number.isFinite(total) && from + page.length >= total) break;

    from += pageSize;
  }

  return { ok: true, status: 200, data: all };
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
// Vercel 은 (req, res) 시그니처를 사용한다. req.method / req.body / req.query 사용.
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

  // ── GET: 방명록 목록 조회 (최신순, 전체) ──────────────────────────────────
  if (req.method === "GET") {
    const { ok, data, parseError } = await supabaseFetchAll(
      "/guestbook_entries?select=nickname,message,created_at&order=created_at.desc",
    );

    if (!ok) {
      const message = parseError
        ? "서버 설정 오류입니다. 관리자에게 문의해 주세요."
        : "방명록을 불러오지 못했습니다.";
      sendJson(res, parseError ? 503 : 502, { error: message });
      return;
    }

    sendJson(res, 200, { entries: data, count: data.length });
    return;
  }

  // ── POST: 방명록 글 저장 ──────────────────────────────────────────────────
  if (req.method === "POST") {
    // Vercel 은 Content-Type: application/json 이면 req.body 를 자동 파싱한다.
    // 문자열로 올 수도 있어 둘 다 처리한다.
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

    const { nickname, message } = body;

    // 서버 측 입력 검사 (빈값·길이 초과·제어문자 거절)
    const validationError = validateInput(nickname, message);
    if (validationError) {
      sendJson(res, 400, { error: validationError });
      return;
    }

    // Supabase 에 INSERT
    const { ok, data, parseError } = await supabaseFetch("/guestbook_entries", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        nickname: nickname.trim(),
        message:  message.trim(),
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
