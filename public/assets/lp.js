/* Wデザインメソッド体験LP 共通の動き（3パターン共通） */
(function () {
  document.documentElement.classList.add('js');
  // ?clean を付けると「要確認」の印を隠す（先方に見せるとき用）
  if (/[?&]clean\b/.test(location.search)) document.documentElement.classList.add('clean');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // スクロールで表示（.rv → .in）
  var rv = document.querySelectorAll('.rv');
  var ioFired = false;
  if (reduce || !('IntersectionObserver' in window)) {
    rv.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      ioFired = true;
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    rv.forEach(function (el) { io.observe(el); });
  }
  // 最初から画面内にあるものは、すぐに表示（監視が動かない環境でも白くならないように）
  function showVisible() {
    rv.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('in');
    });
  }
  requestAnimationFrame(showVisible);
  window.addEventListener('load', showVisible);
  setTimeout(function () { if (!ioFired) rv.forEach(function (el) { el.classList.add('in'); }); }, 4000);

  // 講習日程：終わった回は「終了」、次の回に「次回」
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var next = null;
  document.querySelectorAll('[data-course-end]').forEach(function (el) {
    var p = el.getAttribute('data-course-end').split('-');
    var end = new Date(+p[0], +p[1] - 1, +p[2]);
    if (end < today) { el.classList.add('is-past'); }
    else if (!next) { next = el; el.classList.add('is-next'); }
  });
  document.querySelectorAll('[data-next-course]').forEach(function (el) {
    el.textContent = next ? next.getAttribute('data-label') : 'お問い合わせください';
  });

  // 講習日程の二択：これからの回を2つ並べる（決断ではなく比較にする）
  var seen = {}, upcoming = [];
  document.querySelectorAll('[data-course-end]').forEach(function (el) {
    var label = el.getAttribute('data-label');
    if (!el.classList.contains('is-past') && !seen[label]) { seen[label] = true; upcoming.push(label); }
  });
  document.querySelectorAll('[data-date-choice]').forEach(function (root) {
    var links = root.querySelectorAll('[data-choice]');
    links.forEach(function (a, i) {
      if (upcoming[i]) { a.querySelector('[data-choice-label]').textContent = upcoming[i]; }
      else { a.parentNode.removeChild(a); }
    });
    if (!upcoming.length) { var q = root.querySelector('[data-choice-q]'); if (q) q.textContent = '次回の日程は、お問い合わせください'; }
  });

  // 売上シミュレーター（コース22,000円＝税抜20,000円 × 月の件数）
  document.querySelectorAll('[data-sim]').forEach(function (root) {
    var range = root.querySelector('input[type="range"]');
    var count = root.querySelectorAll('[data-sim-count]');
    var sum = root.querySelectorAll('[data-sim-sum]');
    var bar = root.querySelector('[data-sim-bar]');
    function update() {
      var n = +range.value;
      count.forEach(function (el) { el.textContent = n; });
      sum.forEach(function (el) { el.textContent = (n * 2).toLocaleString('ja-JP'); });
      var pct = (n - range.min) / (range.max - range.min) * 100;
      range.style.setProperty('--pct', pct + '%');
      if (bar) bar.style.setProperty('--pct', pct + '%');
    }
    range.addEventListener('input', update);
    update();
  });

  // タブ（制度の3段階など）
  document.querySelectorAll('[data-tabs]').forEach(function (root) {
    var tabs = root.querySelectorAll('[data-tab]');
    var panels = root.querySelectorAll('[data-panel]');
    function show(key) {
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-tab') === key;
        t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== key; });
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () { show(t.getAttribute('data-tab')); });
      t.addEventListener('mouseenter', function () { if (window.matchMedia('(hover: hover)').matches) show(t.getAttribute('data-tab')); });
    });
  });

  // ヘッダー：少しスクロールしたら影
  var header = document.querySelector('[data-header]');
  if (header) {
    var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > 24); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  // スマホの下部ボタン：最初の画面と最後の申込欄が見えている間は隠す
  var sticky = document.querySelector('[data-sticky]');
  var hide = document.querySelectorAll('[data-hide-sticky]');
  if (sticky && hide.length && 'IntersectionObserver' in window) {
    var visible = new Set();
    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.isIntersecting ? visible.add(e.target) : visible.delete(e.target); });
      sticky.classList.toggle('away', visible.size > 0);
    });
    hide.forEach(function (el) { so.observe(el); });
  }
})();
