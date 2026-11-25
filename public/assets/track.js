/* W CRUSH 体験LP の計測
 * ・どの広告から来て、どこまで読み、どのボタンを押し、申し込んだかを、自社サーバー（/api/t）に数として残す。
 *   集計は /stats で見る（server.js）。名前・電話番号などフォームの中身は送らない。
 * ・同じ出来事を Meta ピクセル（trackCustom）と Microsoft Clarity（event / set）にも渡す。
 *   Clarity ではヒートマップ・録画をこの名前で絞り込める。
 * ・広告の URL に付けた utm_* / fbclid は、最初に来たときに覚えておき、フォームの隠し欄にも入れる。
 */
(function () {
  "use strict";
  // Clarity のプロジェクトID（clarity.microsoft.com で作成）。空のあいだは Clarity を読み込まない。
  var CLARITY_ID = "zfwgr1c7u3";

  var W = window, D = document;
  var page = /\/thanks\/?$/.test(location.pathname) ? "thanks" : "lp";

  function store(kind) { try { return W[kind]; } catch (e) { return null; } }
  var LS = store("localStorage"), SS = store("sessionStorage");
  function get(s, k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function put(s, k, v) { try { if (s) s.setItem(k, v); } catch (e) {} }
  function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  // 訪問者（端末ごと）とセッション（タブを閉じるまで）の目印。個人は特定しない。
  var vid = get(LS, "wc_vid"); if (!vid) { vid = rid(); put(LS, "wc_vid", vid); }
  var sid = get(SS, "wc_sid"); var isNewSession = !sid; if (!sid) { sid = rid(); put(SS, "wc_sid", sid); }

  // 流入元。広告の URL パラメータは最初の1回を覚えておく（ページ内を移動しても失わない）
  var q = new URLSearchParams(location.search);
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var src = {};
  try { src = JSON.parse(get(SS, "wc_src") || "{}"); } catch (e) { src = {}; }
  var hasNew = KEYS.some(function (k) { return q.get(k); }) || q.get("fbclid");
  if (hasNew || isNewSession) {
    src = {};
    KEYS.forEach(function (k) { if (q.get(k)) src[k] = q.get(k).slice(0, 80); });
    if (q.get("fbclid")) src.fbclid = 1;
    var r = D.referrer && !/wcrush\.s-toru\.com/.test(D.referrer) ? D.referrer : "";
    if (r) { try { src.ref = new URL(r).hostname; } catch (e) {} }
    put(SS, "wc_src", JSON.stringify(src));
  }
  function channel() {
    if (src.utm_source) return String(src.utm_source).toLowerCase();
    if (src.fbclid) return "meta";
    if (src.ref) {
      if (/facebook|instagram|fb\.|l\.instagram/.test(src.ref)) return "meta(自然)";
      if (/google|yahoo|bing/.test(src.ref)) return "検索";
      if (/line\.me|lin\.ee/.test(src.ref)) return "LINE";
      return src.ref;
    }
    return "直接";
  }

  var dev = (W.innerWidth || 0) < 768 ? "スマホ" : ((W.innerWidth || 0) < 1100 ? "タブレット" : "PC");
  var t0 = Date.now();

  // 自社サーバーへ送る（ページを閉じる瞬間でも届く sendBeacon を優先）
  function send(ev, data) {
    var body = JSON.stringify({
      ev: ev, page: page, vid: vid, sid: sid, ch: channel(), src: src, dev: dev,
      t: Math.round((Date.now() - t0) / 1000), d: data || {}
    });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/t", new Blob([body], { type: "text/plain" }))) return;
    } catch (e) {}
    try { fetch("/api/t", { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } }); } catch (e) {}
  }
  function meta(name, params) { try { if (W.fbq) W.fbq("trackCustom", name, params || {}); } catch (e) {} }
  function cl() { try { if (W.clarity) W.clarity.apply(null, arguments); } catch (e) {} }

  // ---- Clarity の読み込み ----
  if (CLARITY_ID) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(W, D, "clarity", "script", CLARITY_ID);
    cl("set", "流入元", channel());
    if (src.utm_campaign) cl("set", "utm_campaign", src.utm_campaign);
    if (src.utm_content) cl("set", "utm_content", src.utm_content);
    cl("set", "端末", dev);
  }

  // ---- 表示 ----
  send("pv", { path: location.pathname });
  if (page === "thanks") {
    send("lead");
    cl("event", "申し込み完了");
    return; // 完了ページはここまで
  }

  // ---- どこまで読んだか（各節が画面に半分以上入ったら1回） ----
  var seen = {};
  if ("IntersectionObserver" in W) {
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) {
        if (!e.isIntersecting) return;
        var id = e.target.getAttribute("data-track-sec");
        if (seen[id]) return;
        seen[id] = 1; io.unobserve(e.target);
        send("sec", { id: id, i: +e.target.getAttribute("data-track-i") });
        cl("event", "見た:" + id);
        if (id === "apply") meta("ViewApplyForm");
      });
    }, { threshold: [0.35] });
    D.querySelectorAll("main section").forEach(function (s, i) {
      var id = s.id || (s.classList.contains("hero") ? "hero" : (s.classList.contains("final") ? "final" : "sec" + i));
      s.setAttribute("data-track-sec", id);
      s.setAttribute("data-track-i", i);
      io.observe(s);
    });
  }

  // ---- スクロール率（25/50/75/90%） ----
  var marks = [25, 50, 75, 90], hit = {};
  function onScroll() {
    var h = D.documentElement.scrollHeight - W.innerHeight;
    if (h <= 0) return;
    var p = (W.scrollY || W.pageYOffset) / h * 100;
    marks.forEach(function (m) { if (p >= m && !hit[m]) { hit[m] = 1; send("scroll", { p: m }); } });
  }
  W.addEventListener("scroll", onScroll, { passive: true });

  // ---- クリック（ボタン・リンク。画面のどこを押したかの座標はヒートマップ用に割合で残す） ----
  function label(el) {
    var e = el.getAttribute("data-entry");
    if (e) return e;
    var h = el.getAttribute("href") || "";
    if (/lin\.ee|line\.me/.test(h)) return el.closest("footer") ? "line-footer" : "line-form";
    if (/google\.[^/]+\/maps/.test(h)) return "map";
    if (/^tel:/.test(h)) return "tel";
    if (el.classList.contains("logo")) return "logo";
    if (el.closest("form")) return el.type === "submit" ? "form-submit-btn" : "form-other";
    if (el.closest("details,summary")) return "faq";
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30) || h.slice(0, 40) || el.tagName;
  }
  D.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest("a,button,summary,[data-track]") : null;
    var sec = ev.target && ev.target.closest ? ev.target.closest("[data-track-sec]") : null;
    var data = {
      x: Math.round(ev.clientX / Math.max(1, W.innerWidth) * 1000) / 10,
      y: Math.round((ev.pageY || 0) / Math.max(1, D.documentElement.scrollHeight) * 1000) / 10,
      sec: sec ? sec.getAttribute("data-track-sec") : ""
    };
    if (!el) { send("tap", data); return; } // ボタン以外を押した（押せると思われている場所の発見用）
    var name = label(el);
    data.el = name;
    if (el.tagName === "SUMMARY") data.el = "faq:" + (el.textContent || "").trim().slice(0, 24);
    send("click", data);
    cl("event", "押した:" + data.el);
    if (el.hasAttribute("data-entry")) meta("CTAClick", { entry: name, want: el.getAttribute("data-want") || "" });
    if (/^line/.test(name)) meta("LineClick", { place: name });
    if (name === "map") meta("MapClick");
  }, true);

  // ---- フォーム ----
  var form = D.querySelector('form[name="wcrush-apply"]');
  if (form) {
    // 広告の情報を申し込みと一緒に残す（どの広告から申し込みが来たか分かるように）
    var add = { ch: channel() };
    KEYS.forEach(function (k) { if (src[k]) add[k] = src[k]; });
    add.vid = vid;
    Object.keys(add).forEach(function (k) {
      var i = D.createElement("input"); i.type = "hidden"; i.name = "trk_" + k; i.value = add[k];
      form.appendChild(i);
    });
    var started = false, touched = {};
    form.addEventListener("focusin", function (e) {
      // 入力欄（input・select・textarea）だけを数える。フォーム自体にフォーカスが当たると
      // form.name が「name」欄の要素を返し、[object Object] として誤って入力開始に数えていた
      var t = e.target;
      if (!t || !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.type === "hidden") return;
      var n = t.name;
      if (typeof n !== "string" || !n || n === "bot-field") return;
      if (!started) { started = true; send("form_start", { field: n }); meta("FormStart"); cl("event", "フォーム入力開始"); }
      if (!touched[n]) { touched[n] = 1; send("field", { name: n }); }
    });
    form.addEventListener("submit", function () {
      var w = (form.querySelector('input[name="want"]:checked') || {}).value || "";
      send("form_submit", { want: w, entry: (form.querySelector("[data-entry-field]") || {}).value || "" });
      cl("event", "フォーム送信");
    });
    form.addEventListener("invalid", function (e) {
      send("form_invalid", { name: (e.target && e.target.name) || "" });
    }, true);
  }

  // ---- 滞在時間（ページを離れる・隠れるときに1回） ----
  var sentDwell = false;
  function dwell() {
    if (sentDwell) return; sentDwell = true;
    var maxp = 0; marks.forEach(function (m) { if (hit[m]) maxp = m; });
    send("leave", { sec: Math.round((Date.now() - t0) / 1000), maxScroll: maxp });
  }
  D.addEventListener("visibilitychange", function () { if (D.visibilityState === "hidden") dwell(); });
  W.addEventListener("pagehide", dwell);
})();
