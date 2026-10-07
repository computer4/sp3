/* STAR PRODUCTION — decides between "server mode" and "standalone mode" for every page, and wires standalone mode in.
   Load order on each page: data/plans.js → assets/standalone.js → this file → the page's own scripts.

   • Server reachable  (the real site, or START.bat on this computer)  → requests go to the server, nothing changes.
   • No server         (index.html opened from a folder / plain web host) → /api/... requests are answered in the browser. */
(function () {
  'use strict';
  var SA = window.STAR_STANDALONE;
  if (!SA || window.__starBoot) return;
  window.__starBoot = true;

  var nativeFetch = window.fetch.bind(window), NativeES = window.EventSource;
  var IS_FILE = location.protocol === 'file:';
  var page = location.pathname.split('/').pop() || 'index.html';
  var base = window.STAR_API_BASE || '';
  var delay = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ── Which mode? ── */
  function probe(url, noCors) {
    var req = nativeFetch(url, noCors ? { mode: 'no-cors' } : { credentials: 'include' }).then(function (r) {
      if (noCors) return true;
      return r.ok ? r.json().then(function (j) { return !!(j && j.ok); }).catch(function () { return false; }) : false;
    });
    return Promise.race([req, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 2500); })]);
  }
  var modeP = (function () {
    if (IS_FILE) {
      // Opened from a folder: if the server runs on this computer (START.bat), move to it; otherwise work standalone.
      return probe('http://localhost:4000/api/health', true).then(function () {
        location.replace('http://localhost:4000/' + page + location.search + location.hash);
        return new Promise(function () {});
      }, function () { return 'standalone'; });
    }
    var url = base + '/api/health';
    return probe(url).catch(function () { return delay(900).then(function () { return probe(url); }); })
      .then(function (ok) { return ok ? 'server' : 'standalone'; }, function () { return 'standalone'; });
  })();
  window.STAR_MODE = modeP;

  /* ── Browser storage (falls back to memory if the browser blocks it) ── */
  var mem = {};
  var storage = (function () {
    try { var k = '__star_t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch (e) {}
    return { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); } };
  })();
  var SESSION_KEY = 'star.sa.session';
  function readSession() { try { return JSON.parse(storage.getItem(SESSION_KEY) || '{}') || {}; } catch (e) { return {}; } }

  /* ── Live updates between tabs and inside this tab ── */
  var listeners = [];
  var channel = null;
  try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('star-sa') : null; } catch (e) {}
  function fire() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} }); }
  if (channel) channel.onmessage = fire;
  window.addEventListener('storage', function (e) { if (e.key === 'star.sa.db') fire(); });

  var engine = SA.createEngine({
    storage: storage,
    plans: window.STAR_PLANS || [],
    faq: function () { return window.STAR_FAQ || null; },
    onChange: function () { fire(); if (channel) channel.postMessage('u'); }
  });

  function loadFaq() {
    if (window.STAR_FAQ) return Promise.resolve();
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'data/chat/faq.js'; s.onload = s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
  }
  function toBlob(dataUrl) {
    var m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl), bin = atob(m[2]), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] });
  }

  /* ── fetch(): /api/... goes to the server or to the standalone engine ── */
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var m = /^(?:https?:\/\/[^\/]+)?(\/api\/[^#]*)$/.exec(url);
    if (!m) return nativeFetch(input, init);
    return modeP.then(function (mode) {
      if (mode === 'server') return nativeFetch(input, init);
      var method = ((init && init.method) || 'GET').toUpperCase(), body = null;
      if (init && init.body) { try { body = JSON.parse(init.body); } catch (e) { body = null; } }
      var ctx = { session: readSession() };
      return (/^\/api\/chat\//.test(m[1]) ? loadFaq() : Promise.resolve()).then(function () { return engine.handle(method, m[1], body, ctx); }).then(function (res) {
        storage.setItem(SESSION_KEY, JSON.stringify(ctx.session));
        if (res.image) return new Response(toBlob(res.image.dataUrl), { status: 200, headers: { 'Content-Type': res.image.mime } });
        return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
      });
    });
  };

  /* ── EventSource: the real stream in server mode, local signals in standalone mode ── */
  if (NativeES) {
    window.EventSource = function (url, opts) {
      var self = this, subs = {}, real = null, closed = false, ping = function () { (subs.update || []).forEach(function (fn) { fn({ type: 'update' }); }); };
      this.readyState = 0;
      this.addEventListener = function (type, fn) { (subs[type] = subs[type] || []).push(fn); if (real) real.addEventListener(type, fn); };
      this.removeEventListener = function (type, fn) { subs[type] = (subs[type] || []).filter(function (f) { return f !== fn; }); if (real) real.removeEventListener(type, fn); };
      this.close = function () { closed = true; self.readyState = 2; if (real) real.close(); var i = listeners.indexOf(ping); if (i > -1) listeners.splice(i, 1); };
      modeP.then(function (mode) {
        if (closed) return;
        if (mode === 'server') {
          real = new NativeES(url, opts);
          real.onopen = function (e) { self.readyState = 1; if (self.onopen) self.onopen(e); };
          real.onerror = function (e) { if (self.onerror) self.onerror(e); };
          Object.keys(subs).forEach(function (t) { subs[t].forEach(function (fn) { real.addEventListener(t, fn); }); });
        } else {
          listeners.push(ping);
          self.readyState = 1;
          setTimeout(function () { if (self.onopen) self.onopen({ type: 'open' }); }, 0);
        }
      });
    };
    window.EventSource.CONNECTING = 0; window.EventSource.OPEN = 1; window.EventSource.CLOSED = 2;
  }

  /* ── A small, honest notice in standalone mode ── */
  modeP.then(function (mode) {
    if (mode !== 'standalone') return;
    var closed = false; try { closed = sessionStorage.getItem('star.sa.banner') === '1'; } catch (e) {}
    if (closed) return;
    function show() {
      var st = document.createElement('style');
      st.textContent = '.sa-banner{position:fixed;left:16px;bottom:16px;z-index:70;max-width:min(360px,calc(100vw - 110px));padding:10px 38px 10px 14px;background:rgba(12,9,13,.92);color:#EBEBEB;border:1px solid rgba(235,235,235,.22);font:500 .74rem/1.45 system-ui,sans-serif;box-shadow:0 12px 40px -10px rgba(0,0,0,.7)}.sa-banner b{display:block;letter-spacing:.14em;text-transform:uppercase;font-size:.62rem;color:#33aed6;margin-bottom:2px}.sa-banner button{position:absolute;top:6px;right:6px;width:24px;height:24px;border:0;background:rgba(235,235,235,.1);color:inherit;border-radius:50%;cursor:pointer;font-size:14px;line-height:1}';
      document.head.appendChild(st);
      var el = document.createElement('div');
      el.className = 'sa-banner'; el.setAttribute('role', 'status');
      el.innerHTML = '<b>Standalone mode</b>Everything works here and is saved in this browser only. The online site shares data between everyone.<button type="button" aria-label="Dismiss">×</button>';
      el.querySelector('button').addEventListener('click', function () { el.remove(); try { sessionStorage.setItem('star.sa.banner', '1'); } catch (e) {} });
      document.body.appendChild(el);
      setTimeout(function () { el.style.transition = 'opacity .6s'; el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 700); }, 12000); // fades away by itself
    }
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  });
})();
