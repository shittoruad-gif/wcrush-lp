// LP の計測データの受け取り（POST /api/t）と、集計ページ（GET /stats）。
// ・LP の public/assets/track.js が送る出来事を data/events.jsonl に1行ずつ足す。
//   名前・電話番号などフォームの中身は受け取らない（track.js が送らない・ここでも項目を絞る）。
// ・/stats は環境変数 STATS_KEY と同じ値を ?k= に付けたときだけ開く。STATS_KEY が無ければ 404。
// ・集計は開くたびにファイルを読み直して計算する（LP 1枚の量なので十分）。
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const EVENTS = ["pv", "lead", "sec", "scroll", "click", "tap", "form_start", "field", "form_submit", "form_invalid", "leave"];
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|monitor/i;

// 節の id → 表示名（LP の見出し）。知らない id はそのまま出す
const SEC_NAME = {
  hero: "ファーストビュー", problems: "サロンのお悩み", "before-after": "Before / After", method: "商品×技術",
  technique: "技術設計", scenes: "施術の様子", product: "商品（美容液）", developer: "開発者", business: "売上の変化",
  certification: "認定制度", showroom: "新宿ショールーム", access: "アクセス", nationwide: "全国対応",
  instructors: "講師紹介", apply: "申し込みフォーム", faq: "よくある質問", final: "最後の誘導",
};
const EL_NAME = {
  "header-trial": "ヘッダー：体験予約", "fv-trial": "FV：体験予約", "fv-consult": "FV：説明を聞く",
  "pain-trial": "お悩み下：体験予約", "pain-consult": "お悩み下：説明を聞く", "ba-trial": "B/A下：体験予約", "ba-consult": "B/A下：説明を聞く",
  "mid-trial": "中盤：体験予約", "mid-consult": "中盤：説明を聞く", "final-trial": "最後：体験予約", "final-consult": "最後：説明を聞く",
  "sticky-trial": "画面下の固定ボタン", "line-form": "LINE（フォーム下）", "line-footer": "LINE（フッター）", map: "地図を開く",
  "form-submit-btn": "送信ボタン", logo: "ロゴ",
  "line-fv": "LINE（ファーストビュー）", "line-pain": "LINE（お悩み下）", "line-ba": "LINE（B/A下）", "line-mid": "LINE（中盤）", "line-sticky": "LINE（画面下の固定ボタン）",
};
const FIELD_NAME = {
  want: "ご希望の内容", trial_place: "体験場所", consult_way: "説明の方法", salon: "サロン名", name: "ご担当者名", tel: "電話番号",
  email: "メール", pref: "都道府県", date1: "第1希望日", time1: "第1希望の時間", date2: "第2希望日", time2: "第2希望の時間",
  date3: "第3希望日", time3: "第3希望の時間", message: "ご質問・ご要望",
};

const s = (v, n = 80) => (v == null ? "" : String(v).slice(0, n));
const num = (v) => (Number.isFinite(+v) ? Math.round(+v * 10) / 10 : undefined);

export async function handleTrack(req, res, dataDir) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 4096) { res.writeHead(413).end(); return; } }
  res.writeHead(204, { "Cache-Control": "no-store" }).end();
  if (BOT.test(req.headers["user-agent"] || "")) return;
  let b;
  try { b = JSON.parse(raw); } catch { return; }
  if (!b || !EVENTS.includes(b.ev)) return;
  const d = b.d || {};
  const src = b.src || {};
  // 受け取る項目はここで決めたものだけ（何を送られても、これ以外は残さない）
  const rec = {
    at: new Date().toISOString(), ev: b.ev, page: s(b.page, 10), vid: s(b.vid, 24), sid: s(b.sid, 24),
    ch: s(b.ch, 40), dev: s(b.dev, 10), t: num(b.t),
    src: { utm_source: s(src.utm_source), utm_medium: s(src.utm_medium), utm_campaign: s(src.utm_campaign), utm_content: s(src.utm_content), utm_term: s(src.utm_term), fbclid: src.fbclid ? 1 : 0, ref: s(src.ref, 60) },
    d: { id: s(d.id, 30), i: num(d.i), p: num(d.p), el: s(d.el, 50), sec: s(d.sec, 30), x: num(d.x), y: num(d.y), name: s(d.name, 20), field: s(d.field, 20), want: s(d.want, 20), entry: s(d.entry, 30), maxScroll: num(d.maxScroll), path: s(d.path, 60) },
  };
  for (const k of Object.keys(rec.src)) if (!rec.src[k]) delete rec.src[k];
  for (const k of Object.keys(rec.d)) if (rec.d[k] === "" || rec.d[k] === undefined) delete rec.d[k];
  try {
    await mkdir(dataDir, { recursive: true });
    await appendFile(join(dataDir, "events.jsonl"), JSON.stringify(rec) + "\n", "utf-8");
  } catch (e) { console.error("[track] 保存できませんでした", e?.message ?? e); }
}

async function readJsonl(file) {
  try {
    return (await readFile(file, "utf-8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

const jstDay = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const median = (arr) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function computeStats(events, apps, { days = 30, ch = "", camp = "" } = {}) {
  const since = Date.now() - days * 86400e3;
  let ev = events.filter((e) => new Date(e.at).getTime() >= since);
  if (ch) ev = ev.filter((e) => e.ch === ch);
  if (camp) ev = ev.filter((e) => (e.src?.utm_campaign || "") === camp || (e.src?.utm_content || "") === camp);
  const appsIn = apps.filter((a) => new Date(a.at).getTime() >= since && (!ch || a.trk_ch === ch) && (!camp || a.trk_utm_campaign === camp || a.trk_utm_content === camp));

  // セッションごとにまとめる
  const S = new Map();
  for (const e of ev) {
    if (!S.has(e.sid)) S.set(e.sid, { sid: e.sid, vid: e.vid, ch: e.ch, dev: e.dev, src: e.src || {}, day: jstDay(e.at), pv: 0, secs: new Set(), maxScroll: 0, clicks: [], formStart: false, submit: false, lead: false, dwell: 0, fields: new Set(), lastField: "" });
    const x = S.get(e.sid);
    if (e.ev === "pv" && e.page === "lp") x.pv++;
    if (e.ev === "sec") x.secs.add(e.d.id);
    if (e.ev === "scroll") x.maxScroll = Math.max(x.maxScroll, e.d.p || 0);
    if (e.ev === "click") x.clicks.push(e.d.el);
    if (e.ev === "form_start") x.formStart = true;
    if (e.ev === "field") { x.fields.add(e.d.name); x.lastField = e.d.name; }
    if (e.ev === "form_submit") x.submit = true;
    if (e.ev === "lead") x.lead = true;
    if (e.ev === "leave" && e.page === "lp") x.dwell = Math.max(x.dwell, e.t || 0);
  }
  const sess = [...S.values()].filter((x) => x.pv > 0);
  const N = sess.length;

  const funnel = [
    ["LPを開いた", N],
    ["申し込みフォームまで読んだ", sess.filter((x) => x.secs.has("apply")).length],
    ["フォームに入力を始めた", sess.filter((x) => x.formStart).length],
    ["送信ボタンを押した", sess.filter((x) => x.submit).length],
    ["申し込み完了（完了ページ）", sess.filter((x) => x.lead).length],
  ];

  // 日別
  const daysMap = new Map();
  for (const x of sess) {
    const d = daysMap.get(x.day) || { day: x.day, vids: new Set(), sessions: 0, apply: 0, start: 0, lead: 0, ad: 0 };
    d.vids.add(x.vid); d.sessions++; if (x.secs.has("apply")) d.apply++; if (x.formStart) d.start++; if (x.lead) d.lead++;
    if (x.src.fbclid || x.src.utm_source) d.ad++;
    daysMap.set(x.day, d);
  }
  const appsByDay = {};
  for (const a of appsIn) { const k = jstDay(a.at); appsByDay[k] = (appsByDay[k] || 0) + 1; }
  const daily = [...daysMap.values()].sort((a, b) => b.day.localeCompare(a.day)).map((d) => ({ ...d, visitors: d.vids.size, apps: appsByDay[d.day] || 0 }));

  // 流入元別・広告別
  const group = (keyFn) => {
    const m = new Map();
    for (const x of sess) {
      const k = keyFn(x) || "（なし）";
      const g = m.get(k) || { key: k, sessions: 0, apply: 0, start: 0, lead: 0, dw: [] };
      g.sessions++; if (x.secs.has("apply")) g.apply++; if (x.formStart) g.start++; if (x.lead) g.lead++; g.dw.push(x.dwell);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.sessions - a.sessions).map((g) => ({ ...g, dwell: median(g.dw), rate: pct(g.lead, g.sessions) }));
  };
  const byChannel = group((x) => x.ch);
  const byCampaign = group((x) => [x.src.utm_campaign, x.src.utm_content].filter(Boolean).join(" / "));
  const byDevice = group((x) => x.dev);

  // どこまで読んだか（節ごとの到達率、LP の並び順）
  const order = new Map();
  for (const e of ev) if (e.ev === "sec" && e.d.i !== undefined && !order.has(e.d.id)) order.set(e.d.id, e.d.i);
  const secReach = [...order.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => {
    const n = sess.filter((x) => x.secs.has(id)).length;
    return { id, name: SEC_NAME[id] || id, n, rate: pct(n, N) };
  });
  const scroll = [25, 50, 75, 90].map((p) => ({ p, n: sess.filter((x) => x.maxScroll >= p).length, rate: pct(sess.filter((x) => x.maxScroll >= p).length, N) }));

  // クリック
  const cm = new Map();
  for (const e of ev) {
    if (e.ev !== "click") continue;
    const k = e.d.el;
    const c = cm.get(k) || { el: k, name: EL_NAME[k] || k, n: 0, sids: new Set(), sec: e.d.sec };
    c.n++; c.sids.add(e.sid); cm.set(k, c);
  }
  const clicks = [...cm.values()].sort((a, b) => b.n - a.n).map((c) => ({ ...c, people: c.sids.size, rate: pct(c.sids.size, N) }));

  // ボタン以外が押された場所（押せると思われている所）
  const tm = new Map();
  for (const e of ev) if (e.ev === "tap") tm.set(e.d.sec || "?", (tm.get(e.d.sec || "?") || 0) + 1);
  const taps = [...tm.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: SEC_NAME[id] || id, n }));

  // フォームの入力（どの欄まで進んだか・どの欄で引っかかったか）
  const fstart = sess.filter((x) => x.formStart);
  const fm = new Map();
  for (const x of fstart) for (const f of x.fields) fm.set(f, (fm.get(f) || 0) + 1);
  const fields = [...fm.entries()].map(([k, n]) => ({ k, name: FIELD_NAME[k] || k, n, rate: pct(n, fstart.length) })).sort((a, b) => b.n - a.n);
  const drop = new Map();
  for (const x of fstart.filter((x) => !x.submit && x.lastField)) drop.set(x.lastField, (drop.get(x.lastField) || 0) + 1);
  const drops = [...drop.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ name: FIELD_NAME[k] || k, n }));
  const inv = new Map();
  for (const e of ev) if (e.ev === "form_invalid") inv.set(e.d.name, (inv.get(e.d.name) || 0) + 1);
  const invalid = [...inv.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ name: FIELD_NAME[k] || k, n }));

  // 申し込み（フォームの控えから。どの入口・どの広告からか）
  const appEntry = {};
  for (const a of appsIn) { const k = EL_NAME[a.entry] || a.entry || "直接"; appEntry[k] = (appEntry[k] || 0) + 1; }
  const appWant = {};
  for (const a of appsIn) { const k = a.want || "?"; appWant[k] = (appWant[k] || 0) + 1; }
  const appAd = {};
  for (const a of appsIn) { const k = [a.trk_ch, a.trk_utm_campaign, a.trk_utm_content].filter(Boolean).join(" / ") || "（記録なし）"; appAd[k] = (appAd[k] || 0) + 1; }

  const dwells = sess.map((x) => x.dwell).filter((v) => v > 0);
  const summary = {
    sessions: N, visitors: new Set(sess.map((x) => x.vid)).size, applications: appsIn.length,
    fromAd: sess.filter((x) => x.src.fbclid || x.src.utm_source).length,
    medianDwell: median(dwells), cvr: pct(appsIn.length, N),
  };
  return { days, ch, camp, summary, funnel, daily, byChannel, byCampaign, byDevice, secReach, scroll, clicks, taps, fields, drops, invalid, appEntry, appWant, appAd, channels: [...new Set(events.map((e) => e.ch).filter(Boolean))] };
}

function bar(rate) { return `<span class="bar"><i style="width:${Math.min(100, rate)}%"></i></span>`; }
function sec(m) { return m >= 60 ? `${Math.floor(m / 60)}分${m % 60}秒` : `${m}秒`; }

function renderHtml(r, key) {
  const q = (o) => "?" + new URLSearchParams({ k: key, days: r.days, ...(r.ch ? { ch: r.ch } : {}), ...(r.camp ? { camp: r.camp } : {}), ...o }).toString();
  const t = (rows, head, fn) => `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(fn).join("") : `<tr><td colspan="${head.length}" class="muted">まだデータがありません</td></tr>`}</tbody></table>`;
  const grp = (rows) => t(rows, ["", "訪問", "フォーム到達", "入力開始", "申込完了", "申込率", "滞在（中央値）"], (g) => `<tr><td>${esc(g.key)}</td><td>${g.sessions}</td><td>${g.apply}</td><td>${g.start}</td><td>${g.lead}</td><td>${g.rate}%</td><td>${sec(g.dwell)}</td></tr>`);
  const obj = (o) => t(Object.entries(o).sort((a, b) => b[1] - a[1]), ["", "件数"], ([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`);
  const S = r.summary;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>W CRUSH 体験LP 計測</title>
<style>
:root{--bg:#f7f5f1;--card:#fff;--ink:#231e18;--mut:#8a8278;--line:#e6e0d6;--acc:#a87e3e}
@media (prefers-color-scheme:dark){:root{--bg:#141210;--card:#1d1a17;--ink:#f2eee8;--mut:#9a9288;--line:#2e2a25;--acc:#deb880}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,"Hiragino Sans",sans-serif}
.w{max-width:1100px;margin:0 auto;padding:20px 16px 60px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px}
.muted{color:var(--mut)}.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
.kpi div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.kpi b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
.kpi span{font-size:12px;color:var(--mut)}table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-variant-numeric:tabular-nums}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left;white-space:normal}th{font-size:12px;color:var(--mut);font-weight:600}
.bar{display:inline-block;width:120px;height:8px;background:var(--line);border-radius:4px;vertical-align:middle;margin-left:8px;overflow:hidden}.bar i{display:block;height:100%;background:var(--acc)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:760px){.two{grid-template-columns:1fr}.bar{width:60px}}
.tabs a{display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border:1px solid var(--line);border-radius:999px;color:var(--ink);text-decoration:none;font-size:13px;background:var(--card)}.tabs a.on{border-color:var(--acc);color:var(--acc)}
.sc{overflow-x:auto}a{color:var(--acc)}
</style></head><body><div class="w">
<h1>W CRUSH 体験LP 計測</h1>
<p class="muted">https://wcrush.s-toru.com/wcrush/ ／ 直近${r.days}日${r.ch ? ` ／ 流入元：${esc(r.ch)}` : ""}${r.camp ? ` ／ 広告：${esc(r.camp)}` : ""}（日本時間。開くたびに最新の数を計算しています）</p>
<div class="tabs">${[1, 7, 30, 90].map((d) => `<a class="${d === r.days ? "on" : ""}" href="${q({ days: d })}">${d === 1 ? "今日まで24時間" : `直近${d}日`}</a>`).join("")}
${r.ch ? `<a href="${q({ ch: "" })}">流入元の絞り込みを外す</a>` : ""}${r.camp ? `<a href="${q({ camp: "" })}">広告の絞り込みを外す</a>` : ""}<a href="${q({ format: "json" })}">JSON</a></div>
<div class="kpi"><div><span>訪問（セッション）</span><b>${S.sessions}</b></div><div><span>訪問者（端末）</span><b>${S.visitors}</b></div><div><span>うち広告から</span><b>${S.fromAd}</b></div><div><span>申し込み</span><b>${S.applications}</b></div><div><span>申込率（申込÷訪問）</span><b>${S.cvr}%</b></div><div><span>滞在時間（中央値）</span><b>${sec(S.medianDwell)}</b></div></div>
<h2>申し込みまでの流れ</h2><div class="sc">${t(r.funnel, ["", "人数", "最初からの割合"], ([k, n]) => `<tr><td>${k}</td><td>${n}</td><td>${pct(n, r.funnel[0][1])}%${bar(pct(n, r.funnel[0][1]))}</td></tr>`)}</div>
<h2>流入元別</h2><div class="sc">${t(r.byChannel, ["", "訪問", "フォーム到達", "入力開始", "申込完了", "申込率", "滞在（中央値）"], (g) => `<tr><td><a href="${q({ ch: g.key })}">${esc(g.key)}</a></td><td>${g.sessions}</td><td>${g.apply}</td><td>${g.start}</td><td>${g.lead}</td><td>${g.rate}%</td><td>${sec(g.dwell)}</td></tr>`)}</div>
<h2>広告別（utm_campaign / utm_content）</h2><div class="sc">${t(r.byCampaign, ["", "訪問", "フォーム到達", "入力開始", "申込完了", "申込率", "滞在（中央値）"], (g) => `<tr><td>${g.key === "（なし）" ? g.key : `<a href="${q({ camp: g.key.split(" / ").pop() })}">${esc(g.key)}</a>`}</td><td>${g.sessions}</td><td>${g.apply}</td><td>${g.start}</td><td>${g.lead}</td><td>${g.rate}%</td><td>${sec(g.dwell)}</td></tr>`)}</div>
<h2>どこまで読まれたか（節ごとの到達率）</h2><div class="sc">${t(r.secReach, ["節", "人数", "到達率"], (x) => `<tr><td>${esc(x.name)}</td><td>${x.n}</td><td>${x.rate}%${bar(x.rate)}</td></tr>`)}</div>
<div class="two"><div><h2>スクロール</h2>${t(r.scroll, ["ページの", "人数", "割合"], (x) => `<tr><td>${x.p}%まで</td><td>${x.n}</td><td>${x.rate}%${bar(x.rate)}</td></tr>`)}</div>
<div><h2>端末</h2>${grp(r.byDevice)}</div></div>
<h2>押されたボタン・リンク</h2><div class="sc">${t(r.clicks, ["ボタン", "押された回数", "押した人", "訪問に対する割合"], (c) => `<tr><td>${esc(c.name)}</td><td>${c.n}</td><td>${c.people}</td><td>${c.rate}%${bar(c.rate)}</td></tr>`)}</div>
<div class="two"><div><h2>ボタン以外が押された場所</h2><p class="muted">押せると思われている所の手がかり</p>${t(r.taps, ["節", "回数"], (x) => `<tr><td>${esc(x.name)}</td><td>${x.n}</td></tr>`)}</div>
<div><h2>フォームで止まった欄</h2><p class="muted">入力を始めて送信しなかった人の、最後に触った欄</p>${t(r.drops, ["欄", "人数"], (x) => `<tr><td>${esc(x.name)}</td><td>${x.n}</td></tr>`)}</div></div>
<div class="two"><div><h2>フォームの欄ごとの入力</h2>${t(r.fields, ["欄", "触った人", "入力開始に対する割合"], (x) => `<tr><td>${esc(x.name)}</td><td>${x.n}</td><td>${x.rate}%</td></tr>`)}</div>
<div><h2>未入力・形式エラーで止められた欄</h2>${t(r.invalid, ["欄", "回数"], (x) => `<tr><td>${esc(x.name)}</td><td>${x.n}</td></tr>`)}</div></div>
<div class="two"><div><h2>申し込みの内容</h2>${obj(r.appWant)}<h2>申し込みの入口（押したボタン）</h2>${obj(r.appEntry)}</div><div><h2>申し込みの流入元・広告</h2>${obj(r.appAd)}</div></div>
<h2>日別</h2><div class="sc">${t(r.daily, ["日付", "訪問者", "訪問", "うち広告", "フォーム到達", "入力開始", "完了ページ", "申し込み（控え）"], (d) => `<tr><td>${d.day}</td><td>${d.visitors}</td><td>${d.sessions}</td><td>${d.ad}</td><td>${d.apply}</td><td>${d.start}</td><td>${d.lead}</td><td>${d.apps}</td></tr>`)}</div>
<p class="muted" style="margin-top:24px">ヒートマップ・録画は Microsoft Clarity、広告の成果は Meta 広告マネージャで見られます。ここの数は自社サーバーで数えたもので、広告ブロックを入れている人や、計測前に閉じた人は入らないため、Meta の数とは少しずれます。</p>
</div></body></html>`;
}

export async function handleStats(req, res, dataDir) {
  const key = process.env.STATS_KEY || "";
  const u = new URL(req.url, "http://x");
  if (!key || u.searchParams.get("k") !== key) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found"); return; }
  const days = Math.min(365, Math.max(1, parseInt(u.searchParams.get("days") || "30", 10) || 30));
  const [events, apps] = await Promise.all([readJsonl(join(dataDir, "events.jsonl")), readJsonl(join(dataDir, "applications.jsonl"))]);
  const r = computeStats(events, apps, { days, ch: u.searchParams.get("ch") || "", camp: u.searchParams.get("camp") || "" });
  const head = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
  if (u.searchParams.get("format") === "json") {
    const strip = JSON.parse(JSON.stringify(r, (k, v) => (v instanceof Set ? v.size : k === "dw" || k === "vids" || k === "sids" ? undefined : v)));
    res.writeHead(200, { ...head, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(strip, null, 2));
    return;
  }
  res.writeHead(200, { ...head, "Content-Type": "text/html; charset=utf-8" }).end(renderHtml(r, key));
}
