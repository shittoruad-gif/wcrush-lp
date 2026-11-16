// W CRUSH 体験LP（グラツィア様）の配信と、お申し込みフォームの受け取り。
// ・静的ファイルは public/ をそのまま配る（作り元は lp/grazia の _src/build5.py → _src/publish.py）
// ・お申し込みは POST /api/apply で受け、まず控えをファイルに書いてから、通知メールを送る。
//   メールが送れなくても控えは残る（申し込みを落とさないことを最優先にする）。
// ・メールは Resend。RESEND_API_KEY が無い間は、控えだけ残してログに出す。
import { createServer } from "node:http";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 80);
const PUBLIC_DIR = new URL("./public/", import.meta.url).pathname;
const DATA_DIR = process.env.DATA_DIR || "/app/data";
const LOG_FILE = join(DATA_DIR, "applications.jsonl");

// 通知先は環境変数 NOTIFY_TO（カンマ区切り）で渡す。
// 先方のメールアドレスなので、このリポジトリには書かない（公開リポジトリのため）。Coolify の環境変数に入れる。
const NOTIFY_TO = (process.env.NOTIFY_TO || "").split(",").map(s => s.trim()).filter(Boolean);
const MAIL_FROM = process.env.MAIL_FROM || "W CRUSH 体験申し込み <noreply@s-toru.com>";
const MAIL_BCC = (process.env.MAIL_BCC || "").split(",").map(s => s.trim()).filter(Boolean);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".woff2": "font/woff2",
};

// フォームの項目名 → メールに出す日本語の見出し（並び順もこのとおり）
const LABELS = [
  ["want", "ご希望の内容"], ["trial_place", "体験場所"], ["consult_way", "説明の方法"],
  ["salon", "サロン名"], ["name", "ご担当者名"], ["tel", "電話番号"], ["email", "メールアドレス"], ["pref", "都道府県"],
  ["date1", "第1希望日"], ["time1", "第1希望の時間"], ["date2", "第2希望日"], ["time2", "第2希望の時間"],
  ["date3", "第3希望日"], ["time3", "第3希望の時間"], ["message", "ご質問・ご要望"], ["entry", "入口"],
];

const jst = (d) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);

async function sendMail(body) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn("[apply] RESEND_API_KEY が未設定のため、通知メールは送っていません（控えは保存済み）"); return false; }
  if (!NOTIFY_TO.length) { console.warn("[apply] NOTIFY_TO が未設定のため、通知メールは送っていません（控えは保存済み）"); return false; }
  const lines = LABELS.filter(([k]) => body[k]).map(([k, label]) => `${label}：${body[k]}`);
  const text = [
    "W CRUSH 体験のお申し込みがありました。", "",
    ...lines, "",
    `受付日時：${jst(new Date())}（日本時間）`,
    "https://wcrush.s-toru.com/wcrush/",
  ].join("\n");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM, to: NOTIFY_TO, ...(MAIL_BCC.length ? { bcc: MAIL_BCC } : {}),
        reply_to: body.email || undefined,
        subject: `【W CRUSH】${body.want || "お申し込み"}：${body.salon || ""} ${body.name || ""}`.trim(),
        text,
      }),
    });
    if (!res.ok) { console.error("[apply] 通知メールを送れませんでした", res.status, (await res.text()).slice(0, 300)); return false; }
    return true;
  } catch (e) {
    console.error("[apply] 通知メールの送信でエラー", e?.message ?? e);
    return false;
  }
}

async function handleApply(req, res) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) { res.writeHead(413).end("too large"); return; }
  }
  const body = Object.fromEntries(new URLSearchParams(raw));
  // 自動投稿よけ（画面には出ない欄。人が入れることはない）
  if (body["bot-field"]) { res.writeHead(303, { Location: "/wcrush/thanks/" }).end(); return; }
  delete body["bot-field"];

  const record = { at: new Date().toISOString(), ip: req.headers["x-forwarded-for"] || "", ...body };
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(LOG_FILE, JSON.stringify(record) + "\n", "utf-8");
  } catch (e) {
    // 控えが書けなくても、申し込み自体は落とさない（ログに全部出して拾えるようにする）
    console.error("[apply] 控えを保存できませんでした", e?.message ?? e, JSON.stringify(record));
  }
  console.log("[apply] 受付", JSON.stringify({ want: body.want, salon: body.salon, pref: body.pref }));
  await sendMail(body);
  res.writeHead(303, { Location: "/wcrush/thanks/" }).end();
}

async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") { res.writeHead(302, { Location: "/wcrush/" }).end(); return; }
  if (path.endsWith("/")) path += "index.html";
  const file = join(PUBLIC_DIR, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const data = await readFile(file);
    const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
    const cache = extname(file) === ".html" ? "public, max-age=0, must-revalidate" : "public, max-age=604800";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" }).end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" })
      .end('<meta charset="utf-8"><p>ページが見つかりません。<a href="/wcrush/">体験のご案内はこちら</a></p>');
  }
}

createServer((req, res) => {
  if (req.url === "/healthz") { res.writeHead(200).end("ok"); return; }
  if (req.method === "POST" && req.url === "/api/apply") { handleApply(req, res).catch(e => { console.error(e); res.writeHead(500).end("error"); }); return; }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end("method not allowed"); return; }
  serveStatic(req, res).catch(e => { console.error(e); res.writeHead(500).end("error"); });
}).listen(PORT, () => console.log(`[wcrush-lp] listening on ${PORT} / 通知先 ${NOTIFY_TO.join(", ")}`));
