/* STAR PRODUCTION — shared code for the portal pages (dashboard.html, admin.html).
   API helper, formatting, status badges, project stages, header and the live-update connection. */
(function () {
  'use strict';
  var STAR = window.STAR = {};

  var IS_FILE = location.protocol === 'file:'; // (the standalone-boot.js file moves to the server or runs standalone)

  /* ── Where the API lives: same origin by default, so it works on any domain the site is hosted on ── */
  var API_BASE = (function () {
    if (window.STAR_API_BASE) return window.STAR_API_BASE;
    if (IS_FILE) return 'http://localhost:4000';
    if (location.port === '5500' || location.port === '5501') return location.protocol + '//' + location.hostname + ':4000';
    return '';
  })();
  STAR.API_BASE = API_BASE;
  STAR.IS_FILE = IS_FILE;

  /* ── Helpers ── */
  var $ = STAR.$ = function (s, r) { return (r || document).querySelector(s); };
  STAR.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  STAR.esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var esc = STAR.esc;
  STAR.inr = function (n) { return n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };
  STAR.fmtDate = function (v, time) { if (!v) return '—'; var o = { day: 'numeric', month: 'short', year: 'numeric' }; if (time) { o.hour = '2-digit'; o.minute = '2-digit'; } return new Date(v).toLocaleDateString('en-IN', o); };
  STAR.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ICONS = {
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    close: '<path d="M5 5l14 14M19 5 5 19"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    alert: '<path d="M12 8v5m0 3.5v.01M10.3 3.9 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    info: '<path d="M12 16v-5m0-3.5v-.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
  };
  STAR.icon = function (name, cls, sw) { return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.5) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>'; };
  STAR.ARROW = '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' + ICONS.arrow + '</svg>';

  STAR.alertBox = function (tone, title, body, action) {
    var ic = tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert';
    return '<div class="alert ' + tone + '" role="' + (tone === 'error' ? 'alert' : 'status') + '">' + STAR.icon(ic, '', 1.8) +
      '<div>' + (title ? '<b>' + title + '</b>' : '') + (body ? '<div class="a-body">' + body + '</div>' : '') + (action ? '<div class="a-action">' + action + '</div>' : '') + '</div></div>';
  };
  STAR.loaderHtml = function (label) { return '<div class="loader" role="status" aria-live="polite"><div><span class="spinner lg"></span>' + esc(label) + '</div></div>'; };
  STAR.setBusy = function (btn, busy, text) {
    if (!btn) return;
    if (busy) {
      btn.dataset.html = btn.innerHTML;
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      btn.innerHTML = '<span class="spinner"></span><span>' + esc(text) + '</span>';
    } else if (btn.dataset.html != null) {
      btn.innerHTML = btn.dataset.html; btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  };

  /* ── Status badges ── */
  var STATUS = {
    PENDING: ['Pending', 'wait'], PAYMENT_PROCESSING: ['Verifying payment', 'wait'], PAID: ['Paid', 'good'],
    CANCELLED: ['Cancelled', 'off'], REFUNDED: ['Refunded', 'off'],
    CREATED: ['Created', 'off'], SUCCESS: ['Success', 'good'], FAILED: ['Failed', 'bad'], UNPAID: ['Not paid', 'off'],
    APPLIED: ['Applied', 'work'], VERIFICATION_PENDING: ['Verification Pending', 'wait'], INFORMATION_CONFIRMED: ['Information Confirmed', 'work'],
    PAYMENT_PENDING: ['Payment Pending', 'wait'], INVOICE_ISSUED: ['Invoice Issued', 'work'], PROJECT_ACTIVE: ['Project Active', 'work'],
    IN_PRODUCTION: ['In Production', 'work'], REVISION: ['Revision', 'wait'], FINAL_DELIVERY: ['Final Delivery', 'work'], COMPLETED: ['Completed', 'good'],
    REVIEW: ['In review', 'wait'], PROCESS: ['In process', 'work'],
    CLIENT: ['Client', 'off'], ADMIN: ['Main admin', 'work'], PAYMENTS: ['Payments admin', 'work'], ACTIVE: ['Active', 'good'], BLOCKED: ['Blocked', 'bad']
  };
  var label = STAR.label = function (s) { return (STATUS[s] || [s])[0]; };
  var badge = STAR.badge = function (s) { var d = STATUS[s] || [s, 'off']; return '<span class="badge ' + d[1] + '">' + esc(d[0]) + '</span>'; };

  /* ── Project stages (shared by dashboard & admin) ── */
  var STAGES = STAR.STAGES = ['APPLIED', 'VERIFICATION_PENDING', 'INFORMATION_CONFIRMED', 'PAYMENT_PENDING', 'INVOICE_ISSUED', 'PROJECT_ACTIVE', 'IN_PRODUCTION', 'REVISION', 'FINAL_DELIVERY', 'COMPLETED'];
  STAR.WORK_STATES = ['REVIEW', 'PROCESS', 'COMPLETED'];
  STAR.STAGE_NOTES = {
    APPLIED: 'We’ve received your application.',
    VERIFICATION_PENDING: 'Our team is verifying your details.',
    INFORMATION_CONFIRMED: 'Your information is confirmed.',
    PAYMENT_PENDING: 'Payment is due — use Pay now to continue.',
    INVOICE_ISSUED: 'Payment received — your invoice is issued.',
    PROJECT_ACTIVE: 'Your project is active and being planned.',
    IN_PRODUCTION: 'Your song is in production.',
    REVISION: 'Revisions are in progress.',
    FINAL_DELIVERY: 'Final files are being delivered.',
    COMPLETED: 'Project completed. Thank you for working with us!'
  };
  STAR.WORK_LABEL = { REVIEW: 'In review', PROCESS: 'In process', COMPLETED: 'Completed' };
  STAR.workBadge = function (w) { return '<span class="badge ' + (w === 'COMPLETED' ? 'good' : w === 'PROCESS' ? 'work' : 'wait') + '">' + esc(STAR.WORK_LABEL[w] || w) + '</span>'; };
  STAR.payBadge = function (o) {
    return badge(o.status === 'PAID' ? 'PAID' : o.paymentStatus) + (o.paymentIncomplete ? '<div class="warn">⚠ Payment incomplete</div>' : '');
  };
  STAR.stageChecklist = function (o) {
    var cur = STAGES.indexOf(o.stage);
    return '<ol class="stage-list" aria-label="Project progress: ' + esc(label(o.stage)) + '">' + STAGES.map(function (s, i) {
      var cls = s === 'COMPLETED' && o.stage === 'COMPLETED' ? 'done' : i < cur ? 'done' : i === cur ? 'current' : '';
      var mark = cls === 'done' ? '✓' : cls === 'current' ? '●' : String(i + 1);
      return '<li class="' + cls + '"' + (i === cur ? ' aria-current="step"' : '') + '><span class="dot" aria-hidden="true">' + mark + '</span><span>' + esc(label(s)) +
        (cls === 'done' ? '<span class="sr-only"> (done)</span>' : cls === 'current' ? '<small>' + esc(STAR.STAGE_NOTES[s]) + '</small>' : '') + '</span></li>';
    }).join('') + '</ol>';
  };

  /* ── State + plans (data/plans.js is the single source of truth; the server's copy replaces it when reachable) ── */
  var state = STAR.state = { user: null, plans: (window.STAR_PLANS || []).slice(), cleanup: null };
  STAR.findPlan = function (id) { return state.plans.filter(function (p) { return p.id === id; })[0] || null; };

  /* ── API (the session cookie is httpOnly and set by the server) ── */
  function ApiError(message, opts) { this.message = message; opts = opts || {}; this.status = opts.status || 0; this.code = opts.code; this.fields = opts.fields || {}; }
  STAR.ApiError = ApiError;
  STAR.offlineMessage = 'We’re having trouble connecting right now. Please check your internet connection and try again in a moment. If it keeps happening, email us at <a class="link" href="mailto:starprod.in@gmail.com">starprod.in@gmail.com</a>.';
  STAR.loginUrl = function () { return 'index.html#/login?next=' + encodeURIComponent('/' + (location.pathname.split('/').pop() || 'dashboard.html').replace('.html', '')); };
  STAR.api = function (method, path, body) {
    return fetch(API_BASE + '/api' + path, {
      method: method, credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).catch(function () {
      throw new ApiError(STAR.offlineMessage, { code: 'NETWORK_ERROR' });
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.ok) return data;
        var e = (data && data.error) || {};
        var err = new ApiError(e.message ? esc(e.message) : 'Something went wrong. Please try again.', { status: res.status, code: e.code, fields: e.fields });
        if (e.code === 'SESSION_EXPIRED' || (e.code === 'UNAUTHENTICATED' && path !== '/auth/me')) location.replace(STAR.loginUrl() + '&expired=1');
        throw err;
      });
    });
  };
  var api = STAR.api;

  /* ── Header (same look as the website) ── */
  STAR.renderHeader = function (user) {
    var host = $('#portal-nav');
    if (!host) return;
    var admin = user && (user.role === 'ADMIN' || user.role === 'PAYMENTS'); // staff
    host.innerHTML =
      '<nav class="container nav-inner" aria-label="Main">' +
        '<div class="portal-left">' + (STAR.headerMenu ? '<button class="menu-dots" type="button" id="dash-menu-btn" aria-label="Open menu" aria-haspopup="true" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>' + (STAR.menuUnread ? '<i class="dot-badge"></i>' : '') + '</button>' : '') +
        '<a href="index.html" class="nav-brand" aria-label="STAR PRODUCTION — home"><span class="logo-crop logo-nav"><img src="Photos/Header.jpeg" alt="" /></span></a></div>' +
        '<div class="portal-actions">' +
          '<span class="live-pill" id="live-pill"' + (STAR.liveOn ? '' : ' hidden') + ' title="This page updates instantly"><i></i>Live</span>' +
          '<a class="btn btn-ghost btn-sm" href="index.html#plans">Plans</a>' +
          (user ? (admin ? '<a class="btn btn-secondary btn-sm" href="admin.html">Admin</a>' : '<a class="btn btn-secondary btn-sm" href="dashboard.html">Dashboard</a>') +
            '<button class="btn btn-ghost btn-sm" type="button" data-logout>Log out</button>' : '<a class="btn btn-primary btn-sm" href="index.html#/login">Login</a>') +
        '</div></nav>';
    host.classList.add('scrolled');
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-logout]');
    if (!b) return;
    STAR.setBusy(b, true, 'Logging out…');
    api('POST', '/auth/logout').catch(function () {}).then(function () { location.href = 'index.html'; });
  });

  /* ── Sign-in check: returns the user, or sends the visitor to the login page ── */
  STAR.requireUser = function (role) {
    return api('GET', '/auth/me').then(function (res) {
      state.user = res.user;
      var staff = res.user.role === 'ADMIN' || res.user.role === 'PAYMENTS';
      if (role === 'STAFF' && !staff) { location.replace('dashboard.html'); return new Promise(function () {}); }
      STAR.renderHeader(res.user);
      return res.user;
    }).catch(function (err) {
      if (err.code === 'NETWORK_ERROR') { STAR.renderHeader(null); throw err; }
      location.replace(STAR.loginUrl());
      return new Promise(function () {});
    });
  };

  /* ── Real-time: the server pushes a tiny "something changed" signal; the page then reloads its own data ── */
  STAR.live = function (onChange) {
    var timer = null, fallback = null;
    function changed() { clearTimeout(timer); timer = setTimeout(onChange, 250); }
    function pill(on) { STAR.liveOn = on; var p = $('#live-pill'); if (p) p.hidden = !on; } // remembered, because the header is redrawn
    function poll() { if (!fallback) fallback = setInterval(onChange, 20000); }
    if (!('EventSource' in window)) return poll();
    var es = new EventSource(API_BASE + '/api/events', { withCredentials: true });
    es.addEventListener('update', changed);
    es.onopen = function () { pill(true); if (fallback) { clearInterval(fallback); fallback = null; } };
    es.onerror = function () { pill(false); poll(); }; // the browser reconnects by itself; meanwhile refresh every 20s
    window.addEventListener('beforeunload', function () { es.close(); });
  };

  /* ── Payments: one method — the UPI QR on pay.html (the dashboard's "Pay now" opens it) ── */
  STAR.startPayment = function (orderId) { location.href = 'pay.html?order_id=' + encodeURIComponent(orderId); };

  /* ── Images behind the login (payment screenshots): fetched with the session, shown from a local blob ── */
  STAR.imageUrl = function (path) {
    return fetch(API_BASE + '/api' + path, { credentials: 'include' }).then(function (res) {
      if (!res.ok) throw new Error('no image');
      return res.blob();
    }).then(function (blob) { return URL.createObjectURL(blob); });
  };
  // <img data-path="/orders/…/proof"> (any path under /api) — also the older data-proof / data-shot forms.
  STAR.fillProofs = function (root) {
    STAR.$$('img[data-path],img[data-proof],img[data-shot]', root).forEach(function (img) {
      var path = img.getAttribute('data-path') ||
        (img.hasAttribute('data-proof') ? '/orders/' + encodeURIComponent(img.getAttribute('data-proof')) + '/proof' : '/admin/payments/' + encodeURIComponent(img.getAttribute('data-shot')) + '/screenshot');
      STAR.imageUrl(path).then(function (u) { img.src = u; img.hidden = false; }).catch(function () { img.alt = 'Screenshot unavailable'; img.hidden = false; });
    });
  };
  /* ── Live plan data (falls back to data/plans.js when the server is unreachable) ── */
  STAR.loadPlans = function () {
    return api('GET', '/plans').then(function (res) { if (res && res.plans && res.plans.length) state.plans = res.plans; }).catch(function () {});
  };
  STAR.shell = function (inner) { return '<div class="page"><div class="glow" aria-hidden="true"></div><div class="container" style="max-width:1150px">' + inner + '</div></div>'; };

  document.documentElement.classList.replace('no-js', 'js');
})();
