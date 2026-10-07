/* STAR PRODUCTION — standalone mode.
   When no server is reachable (the folder is simply opened on a computer, or the files are put on a plain web host),
   this file answers the site's /api/... requests itself and keeps the data in the browser's storage, so every
   feature keeps working: sign up, login, dashboard, plans, upgrade, QR payment + screenshot verification,
   admin panel, messages and the chat assistant.

   The data stays in THIS browser on THIS computer. To share one database between everybody, run the server (see DEPLOY.md);
   the pages detect it automatically and use it instead.

   The rules below mirror server/src (auth, orders, admin, chat) so both modes behave the same. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.STAR_STANDALONE = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ═══════════════ the two official staff accounts (stored as salted hashes, not as plain text) ═══════════════
     MAIN admin     — every client detail, projects, messages; can NOT confirm payments
     PAYMENTS admin — payments (and confirming them), messages, the overview numbers                       */
  var STAFF = [
    { role: 'ADMIN', name: 'Khyal', email: 'khyal.music.work@gmail.com', hash: 'sa$7c1e4a9b52d03f68$89dfa6c978aa97f814e3f7c44163cb498934f878467f7a2c24d35b71c4b06a02' },
    { role: 'PAYMENTS', name: 'Aarav Kaushik', email: 'kaushikaarav80@gmail.com', hash: 'sa$b94d2e07a1c58f36$e73b153e1d1fe2c51b5fcd2e7ff0302fc3fcb111acf2f3454f2d5bdff69cd661' }
  ];
  var isStaffRole = function (r) { return r === 'ADMIN' || r === 'PAYMENTS'; };

  /* ═══════════════ constants (same as server/src/lib/constants.js) ═══════════════ */
  var STAGES = ['APPLIED', 'VERIFICATION_PENDING', 'INFORMATION_CONFIRMED', 'PAYMENT_PENDING', 'INVOICE_ISSUED', 'PROJECT_ACTIVE', 'IN_PRODUCTION', 'REVISION', 'FINAL_DELIVERY', 'COMPLETED'];
  var WORK_STATES = ['REVIEW', 'PROCESS', 'COMPLETED'];
  var ORDER_STATUSES = ['PENDING', 'PAYMENT_PROCESSING', 'PAID', 'CANCELLED', 'REFUNDED'];
  var CLOSED = ['CANCELLED', 'REFUNDED'];
  var stageIndex = function (s) { return STAGES.indexOf(s); };
  var isActiveOrder = function (o) { return o.stage !== 'COMPLETED' && CLOSED.indexOf(o.status) < 0; };
  var isPaymentIncomplete = function (o) { return stageIndex(o.stage) >= stageIndex('PAYMENT_PENDING') && o.status !== 'PAID' && CLOSED.indexOf(o.status) < 0; };
  var isLive = function (o) { return CLOSED.indexOf(o.status) < 0; };
  var OPEN_UPGRADE = ['CREATED', 'PENDING', 'FAILED']; // not finished, not cancelled

  /* ═══════════════ SHA-256 (pure JS, works on http:// and file:// where crypto.subtle may be missing) ═══════════════ */
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(str) {
    var bytes = unescape(encodeURIComponent(str)), l = bytes.length, i, j;
    var n = ((l + 8 >> 6) + 1) * 16, w = new Array(n);
    for (i = 0; i < n; i++) w[i] = 0;
    for (i = 0; i < l; i++) w[i >> 2] |= bytes.charCodeAt(i) << (24 - (i % 4) * 8);
    w[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    w[n - 1] = l * 8;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], W = new Array(64);
    function rotr(x, k) { return (x >>> k) | (x << (32 - k)); }
    for (j = 0; j < n; j += 16) {
      for (i = 0; i < 64; i++) {
        if (i < 16) W[i] = w[j + i];
        else {
          var s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
          W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
        }
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }
  function hashPassword(plain, salt) {
    var h = salt + ':' + plain;
    for (var i = 0; i < 1500; i++) h = sha256(h + salt);
    return 'sa$' + salt + '$' + h;
  }
  function verifyPassword(stored, plain) {
    var parts = String(stored).split('$');
    return parts.length === 3 && hashPassword(plain, parts[1]) === stored;
  }

  /* ═══════════════ validation (same messages as server/src/validation/auth.js) ═══════════════ */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function normalizeMobile(raw) {
    var c = String(raw == null ? '' : raw).replace(/[\s\-().]/g, '');
    if (/^[6-9]\d{9}$/.test(c)) return '+91' + c;
    if (/^0[6-9]\d{9}$/.test(c)) return '+91' + c.slice(1);
    if (/^(\+?91)[6-9]\d{9}$/.test(c)) return '+91' + c.slice(-10);
    if (/^\+[1-9]\d{7,14}$/.test(c) && c.indexOf('+91') !== 0) return c;
    return null;
  }
  function checkEmail(v) {
    v = String(v == null ? '' : v).trim().toLowerCase();
    if (!v) return { error: 'Email is required' };
    if (v.length > 254) return { error: 'Email is too long' };
    if (!EMAIL_RE.test(v)) return { error: 'Enter a valid email address' };
    return { value: v };
  }
  function checkPassword(v) {
    if (typeof v !== 'string' || !v) return 'Password is required';
    if (v.length < 8) return 'Password must be at least 8 characters';
    if (v.length > 128) return 'Password must be at most 128 characters';
    if (!/[A-Za-z]/.test(v)) return 'Password must contain at least one letter';
    if (!/\d/.test(v)) return 'Password must contain at least one number';
    return null;
  }

  /* ═══════════════ the engine ═══════════════ */
  var DB_KEY = 'star.sa.db', PROOF_KEY = 'star.sa.proofs';

  function HttpErr(status, message, code, fields) { this.status = status; this.message = message; this.code = code; this.fields = fields; }
  var bad = function (fields) { return new HttpErr(400, 'Please check the highlighted fields.', 'VALIDATION_ERROR', fields); };

  /**
   * @param {{ storage: {getItem(k):string|null, setItem(k,v):void}, plans: object[], faq?: () => object|null, now?: () => Date,
   *           onChange?: () => void, adminEmail?: string, adminPassword?: string }} opts
   */
  function createEngine(opts) {
    var storage = opts.storage, now = opts.now || function () { return new Date(); };
    var rnd = function (n) {
      var a = new Uint8Array(n), c = typeof crypto !== 'undefined' ? crypto : null;
      if (c && c.getRandomValues) c.getRandomValues(a); else for (var i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
      return a;
    };
    var hex = function (n) { return Array.prototype.map.call(rnd(n), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); };
    var newId = function () { return 'c' + hex(11); };
    var iso = function () { return now().toISOString(); };

    /* ── storage ── */
    function load() {
      var raw = storage.getItem(DB_KEY), db = null;
      try { db = raw ? JSON.parse(raw) : null; } catch (e) { db = null; }
      if (db && !db.upgrades) db.upgrades = []; // data saved by an older version
      if (!db) {
        db = { users: [], orders: [], payments: [], upgrades: [], messages: [] };
        var t = iso();
        (opts.staff || STAFF).forEach(function (a) {
          db.users.push({ id: newId(), name: a.name, email: a.email, mobile: '', role: a.role, status: 'ACTIVE', passwordHash: a.hash || hashPassword(a.password, hex(8)), createdAt: t, updatedAt: t });
        });
        save(db);
      }
      return db;
    }
    function save(db) { storage.setItem(DB_KEY, JSON.stringify(db)); }
    function loadProofs() { try { return JSON.parse(storage.getItem(PROOF_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function saveProofs(p) { storage.setItem(PROOF_KEY, JSON.stringify(p)); }
    function changed() { if (opts.onChange) opts.onChange(); }

    /* ── plans ── */
    function planRows() {
      return opts.plans.map(function (p, i) { return { id: p.id, name: p.name, price: Math.round(p.price), originalPrice: p.originalPrice ? Math.round(p.originalPrice) : null, description: p.description, features: p.features, finalOutput: p.finalOutput, isFeatured: !!p.isFeatured, sortOrder: i, active: true }; });
    }
    var findPlan = function (id) { return planRows().filter(function (p) { return p.id === id; })[0] || null; };
    /* ── discounts (same rules as server/src/lib/discounts.js) ── */
    var NEW_STAR = 'NEW-STAR', NEW_STAR_PCT = 15, REFERRAL_PCT = 10, REWARD_PCT = 10, CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var priceAfter = function (price, pct) { return Math.round(price * (100 - (pct || 0)) / 100); };
    var normalizeCode = function (raw) { return String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, ''); };
    var invalidCode = function (m) { return new HttpErr(400, m, 'INVALID_CODE', { code: m }); };
    function ensureReferralCode(db, u) {
      if (u.referralCode) return u.referralCode;
      var code;
      do { code = 'STAR-'; Array.prototype.forEach.call(rnd(6), function (b) { code += CODE_ALPHABET.charAt(b % CODE_ALPHABET.length); }); }
      while (db.users.some(function (x) { return x.referralCode === code; }));
      u.referralCode = code; return code;
    }
    /** Which discount does this client's next order get? (null = none; throws a friendly error for a bad code) */
    function resolveDiscount(db, u, rawCode) {
      var code = normalizeCode(rawCode);
      if (!code) return (u.rewardCredits || 0) > 0 ? { percent: REWARD_PCT, code: 'REWARD', kind: 'REWARD', referrerId: null, label: 'Referral reward' } : null;
      var earlier = db.orders.filter(function (o) { return o.userId === u.id && o.status !== 'CANCELLED'; });
      if (code === NEW_STAR) {
        if (earlier.length) throw invalidCode('NEW-STAR works on your first order only.');
        return { percent: NEW_STAR_PCT, code: NEW_STAR, kind: 'NEW_STAR', referrerId: null, label: 'NEW-STAR first-order offer' };
      }
      if (/^STAR-[A-Z2-9]{6}$/.test(code)) {
        var owner = db.users.filter(function (x) { return x.referralCode === code; })[0];
        if (!owner || owner.role !== 'CLIENT' || owner.status !== 'ACTIVE') throw invalidCode('This code isn’t valid. Please check it and try again.');
        if (owner.id === u.id) throw invalidCode('You can’t use your own referral code — share it with a friend instead.');
        if (earlier.some(function (o) { return o.discountKind === 'REFERRAL'; })) throw invalidCode('You have already used a referral code.');
        return { percent: REFERRAL_PCT, code: code, kind: 'REFERRAL', referrerId: owner.id, label: 'Friend’s referral code' };
      }
      throw invalidCode('This code isn’t valid. Please check it and try again.');
    }
    var publicDiscount = function (o) { return o.discountPercent ? { percent: o.discountPercent, code: o.discountCode || null, kind: o.discountKind || null, listPrice: o.listPrice == null ? null : o.listPrice, saved: o.listPrice == null ? null : o.listPrice - o.amount } : null; };
    var publicPlan = function (p) { return { id: p.id, name: p.name, price: p.price, originalPrice: p.originalPrice, unit: 'song', description: p.description, features: p.features, finalOutput: p.finalOutput, isFeatured: p.isFeatured }; };

    /* ── serializers (same shapes as server/src/lib/serialize.js) ── */
    // (No emails can be sent from the browser, so every address counts as verified in standalone mode.)
    var publicUser = function (u) { return { id: u.id, name: u.name, email: u.email, mobile: u.mobile, role: u.role, status: u.status, emailVerified: true, createdAt: u.createdAt }; };
    function publicPayment(p) {
      if (!p) return null;
      return { id: p.id, method: 'UPI QR', gateway: p.gateway, reference: p.reference || null, amount: p.amount, status: p.status, note: p.note || null,
        hasProof: !!p.submittedAt, submittedAt: p.submittedAt || null, reviewedAt: p.reviewedAt || null, createdAt: p.createdAt, updatedAt: p.updatedAt };
    }
    function publicUpgrade(u) {
      if (!u) return null;
      return { id: u.id, orderId: u.orderId, fromPlanId: u.fromPlanId, toPlanId: u.toPlanId, amount: u.amount, status: u.status, note: u.note || null, reference: u.reference || null,
        hasProof: !!u.submittedAt, submittedAt: u.submittedAt || null, reviewedAt: u.reviewedAt || null, createdAt: u.createdAt, updatedAt: u.updatedAt };
    }
    function publicOrder(db, o) {
      var plan = findPlan(o.planId), pay = db.payments.filter(function (p) { return p.orderId === o.id; })[0] || null;
      return { id: o.id, plan: plan ? { id: plan.id, name: plan.name } : { id: o.planId }, amount: o.amount, discount: publicDiscount(o), status: o.status, stage: o.stage, workState: o.workState,
        paymentStatus: pay ? pay.status : 'UNPAID', paymentIncomplete: isPaymentIncomplete(o), active: isActiveOrder(o), payment: publicPayment(pay),
        upgrade: publicUpgrade(db.upgrades.filter(function (u) { return u.orderId === o.id && OPEN_UPGRADE.indexOf(u.status) > -1; }).sort(byDateDesc('createdAt'))[0] || null),
        paidAt: o.status === 'PAID' && pay ? pay.updatedAt : null, createdAt: o.createdAt, updatedAt: o.updatedAt };
    }
    var clientRef = function (u) { return u ? { id: u.id, name: u.name, email: u.email, mobile: u.mobile } : null; };
    var userById = function (db, id) { return db.users.filter(function (u) { return u.id === id; })[0] || null; };
    var userByEmail = function (db, e) { return db.users.filter(function (u) { return u.email === e; })[0] || null; };
    function adminUser(db, u) { return Object.assign(publicUser(u), { updatedAt: u.updatedAt, orderCount: db.orders.filter(function (o) { return o.userId === u.id; }).length }); }
    function adminOrder(db, o) { return Object.assign(publicOrder(db, o), { client: clientRef(userById(db, o.userId)) }); }
    function adminUpgrade(db, u) {
      var o = db.orders.filter(function (x) { return x.id === u.orderId; })[0], nm = function (id) { var p = findPlan(id); return p ? p.name : id; };
      return Object.assign(publicUpgrade(u), { kind: 'UPGRADE', method: 'UPI QR',
        screenshotUrl: u.submittedAt ? '/api/admin/upgrades/' + u.id + '/screenshot' : null,
        order: o ? { id: o.id, status: o.status, amount: o.amount, plan: 'Upgrade: ' + nm(u.fromPlanId) + ' → ' + nm(u.toPlanId), client: clientRef(userById(db, o.userId)) } : null });
    }
    function adminPayment(db, p) {
      var o = db.orders.filter(function (x) { return x.id === p.orderId; })[0], plan = o && findPlan(o.planId);
      return Object.assign(publicPayment(p), { kind: 'PLAN',
        screenshotUrl: p.submittedAt ? '/api/admin/payments/' + p.id + '/screenshot' : null,
        order: o ? { id: o.id, status: o.status, amount: o.amount, plan: plan && plan.name, client: clientRef(userById(db, o.userId)) } : null
      });
    }
    var byDateDesc = function (key) { return function (a, b) { return String(b[key]).localeCompare(String(a[key])); }; };

    /* ── auth helpers ── */
    function currentUser(db, ctx) {
      if (!ctx.session || !ctx.session.userId) throw new HttpErr(401, 'Please log in to continue.', 'UNAUTHENTICATED');
      var u = userById(db, ctx.session.userId);
      if (!u) { ctx.session.userId = null; throw new HttpErr(401, 'Your session has expired. Please log in again.', 'SESSION_EXPIRED'); }
      if (u.status === 'BLOCKED') { ctx.session.userId = null; throw new HttpErr(401, 'Please log in to continue.', 'UNAUTHENTICATED'); }
      return u;
    }
    /** Staff only; pass a role ('ADMIN' main admin / 'PAYMENTS' payments admin) to restrict further. */
    function adminOnly(db, ctx, role) {
      var u = currentUser(db, ctx);
      if (!isStaffRole(u.role)) throw new HttpErr(403, 'You do not have access to this area.', 'FORBIDDEN');
      if (role && u.role !== role) throw new HttpErr(403, role === 'PAYMENTS' ? 'Payments are confirmed by the payments admin.' : 'You do not have access to this action.', 'FORBIDDEN');
      return u;
    }
    function findClient(db, id) {
      var u = userById(db, id);
      if (!u) throw new HttpErr(404, 'Client not found.');
      if (isStaffRole(u.role)) throw new HttpErr(400, 'Staff accounts cannot be changed here.');
      return u;
    }
    function messageText(v) {
      var t = String(v == null ? '' : v).trim();
      if (!t) throw bad({ message: 'Please type a message' });
      if (t.length > 1000) throw bad({ message: 'Please keep your message under 1000 characters' });
      return t;
    }
    function saveMessage(db, m) {
      db.messages.push({ id: newId(), userId: m.userId || null, name: m.name || '', email: String(m.email).toLowerCase(), message: m.message, sender: m.sender || 'CLIENT', status: m.status || 'NEW', createdAt: iso() });
    }

    /* ── payment screenshot check (PNG / JPEG / WEBP only) ── */
    function proofKind(dataUrl) {
      var m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl == null ? '' : dataUrl));
      if (!m) return null;
      var size = Math.floor(m[2].length * 3 / 4);
      if (!size || size > 2000000) return null;
      var head = typeof atob === 'function' ? atob(m[2].slice(0, 24)) : Buffer.from(m[2].slice(0, 24), 'base64').toString('binary');
      var png = head.charCodeAt(0) === 0x89 && head.slice(1, 4) === 'PNG';
      var jpeg = head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8;
      var webp = head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
      return (m[1] === 'image/png' && png) || (m[1] === 'image/jpeg' && jpeg) || (m[1] === 'image/webp' && webp) ? m[1] : null;
    }

    /* ═══════════════ routes ═══════════════ */
    var routes = [];
    function route(method, pattern, handler) {
      var keys = [], re = new RegExp('^' + pattern.replace(/:(\w+)/g, function (_, k) { keys.push(k); return '([^/]+)'; }) + '/?$');
      routes.push({ method: method, re: re, keys: keys, handler: handler });
    }

    route('GET', '/health', function () { return { body: { ok: true, standalone: true } }; });
    route('GET', '/plans', function () { return { body: { plans: planRows().map(publicPlan) } }; });

    /* ── auth ── */
    route('POST', '/auth/signup', function (c) {
      var b = c.body || {}, f = {}, db = c.db;
      var name = String(b.name == null ? '' : b.name).trim();
      if (!name) f.name = 'Name is required'; else if (name.length > 100) f.name = 'Name is too long';
      var em = checkEmail(b.email); if (em.error) f.email = em.error;
      var pe = checkPassword(b.password); if (pe) f.password = pe;
      if (!b.confirmPassword) f.confirmPassword = 'Please confirm your password'; else if (b.password !== b.confirmPassword) f.confirmPassword = 'Passwords do not match';
      var mobile = null;
      if (!String(b.mobile == null ? '' : b.mobile).trim()) f.mobile = 'Mobile number is required';
      else { mobile = normalizeMobile(String(b.mobile).trim()); if (!mobile) f.mobile = 'Enter a valid mobile number (e.g. 98765 43210)'; }
      if (Object.keys(f).length) throw bad(f);
      var existing = userByEmail(db, em.value);
      if (existing && existing.status === 'BLOCKED') throw new HttpErr(403, 'This email has been blocked. Please contact STAR PRODUCTION.', 'EMAIL_BLOCKED', { email: 'This email has been blocked. Please contact STAR PRODUCTION.' });
      if (existing) throw new HttpErr(409, 'This Email is already registered', 'EMAIL_TAKEN', { email: 'This Email is already registered' });
      var t = iso(), u = { id: newId(), name: name, email: em.value, mobile: mobile, passwordHash: hashPassword(b.password, hex(8)), role: 'CLIENT', status: 'ACTIVE', createdAt: t, updatedAt: t };
      db.users.push(u);
      c.ctx.session.userId = u.id;
      return { status: 201, body: { user: publicUser(u) }, write: true };
    });
    route('POST', '/auth/login', function (c) {
      var b = c.body || {}, f = {};
      var em = checkEmail(b.email); if (em.error) f.email = em.error;
      if (!b.password) f.password = 'Password is required';
      if (Object.keys(f).length) throw bad(f);
      var u = userByEmail(c.db, em.value);
      if (!u) throw new HttpErr(404, "This Email isn't registered", 'EMAIL_NOT_REGISTERED', { email: "This Email isn't registered" });
      if (!verifyPassword(u.passwordHash, String(b.password))) throw new HttpErr(401, 'Password is wrong', 'WRONG_PASSWORD', { password: 'Password is wrong' });
      if (u.status === 'BLOCKED') throw new HttpErr(403, 'This account has been blocked. Please contact STAR PRODUCTION.', 'ACCOUNT_BLOCKED');
      c.ctx.session.userId = u.id;
      return { body: { user: publicUser(u) } };
    });
    route('POST', '/auth/logout', function (c) { c.ctx.session.userId = null; return { body: { ok: true } }; });
    route('GET', '/auth/me', function (c) { return { body: { user: publicUser(currentUser(c.db, c.ctx)) } }; });
    route('POST', '/auth/change-password', function (c) {
      var u = currentUser(c.db, c.ctx), b = c.body || {}, f = {};
      if (!b.currentPassword) f.currentPassword = 'Enter your current password';
      var pe = checkPassword(b.newPassword); if (pe) f.newPassword = pe;
      if (!b.confirmPassword) f.confirmPassword = 'Please confirm your new password'; else if (b.newPassword !== b.confirmPassword) f.confirmPassword = 'Passwords do not match';
      if (Object.keys(f).length) throw bad(f);
      if (!verifyPassword(u.passwordHash, String(b.currentPassword))) throw new HttpErr(400, 'Current password is wrong', 'WRONG_PASSWORD', { currentPassword: 'Current password is wrong' });
      if (b.currentPassword === b.newPassword) throw new HttpErr(400, 'Choose a password different from your current one', 'VALIDATION_ERROR', { newPassword: 'Choose a password different from your current one' });
      u.passwordHash = hashPassword(b.newPassword, hex(8)); u.updatedAt = iso();
      if (!isStaffRole(u.role)) saveMessage(c.db, { userId: u.id, name: u.name, email: u.email, message: 'Changed their account password.', sender: 'SYSTEM' });
      return { body: { ok: true, message: isStaffRole(u.role) ? 'Your password has been changed.' : 'Your password has been changed. Our team has been informed.' }, write: true };
    });
    route('POST', '/auth/verify-email', function () { throw new HttpErr(400, 'Email verification isn’t needed in this mode — your address is already accepted.', 'VERIFY_TOKEN_INVALID'); });
    route('POST', '/auth/resend-verification-public', function () { return { body: { ok: true, message: 'Email verification isn’t needed in this mode — you can log in right away.' } }; });
    route('POST', '/auth/resend-verification', function (c) { currentUser(c.db, c.ctx); return { body: { ok: true, alreadyVerified: true } }; });
    route('POST', '/auth/forgot-password', function () {
      throw new HttpErr(503, 'Password reset by email isn’t available here. Please ask STAR PRODUCTION to set a new password for you.', 'NOT_AVAILABLE');
    });
    route('POST', '/auth/reset-password', function () { throw new HttpErr(400, 'This reset link is invalid or has expired. Please request a new one.', 'RESET_TOKEN_INVALID'); });

    /* ── client: orders ── */
    function planIdFrom(body) {
      var id = String((body && body.planId) == null ? '' : body.planId).trim();
      if (!id) throw bad({ planId: 'Choose a plan' });
      return id.slice(0, 50);
    }
    route('POST', '/orders', function (c) {
      var u = currentUser(c.db, c.ctx), plan = findPlan(planIdFrom(c.body));
      if (!plan) throw new HttpErr(404, 'This plan is no longer available.', 'PLAN_NOT_FOUND');
      var cur = c.db.orders.filter(function (o) { return o.userId === u.id && o.stage !== 'COMPLETED' && CLOSED.indexOf(o.status) < 0; })[0];
      if (cur) throw new HttpErr(409, 'You already have an active plan (' + findPlan(cur.planId).name + '). You can take a new plan once it is completed.', 'ACTIVE_PLAN_EXISTS');
      var disc = resolveDiscount(c.db, u, (c.body || {}).code);
      var t = iso(), o = { id: newId(), userId: u.id, planId: plan.id, amount: disc ? priceAfter(plan.price, disc.percent) : plan.price, status: 'PENDING', stage: 'APPLIED', workState: 'REVIEW', createdAt: t, updatedAt: t };
      if (disc) {
        Object.assign(o, { listPrice: plan.price, discountPercent: disc.percent, discountCode: disc.code, discountKind: disc.kind, referrerId: disc.referrerId, rewardGiven: false });
        if (disc.kind === 'REWARD') u.rewardCredits = Math.max(0, (u.rewardCredits || 0) - 1);
      }
      c.db.orders.push(o);
      return { status: 201, body: { order: publicOrder(c.db, o) }, write: true };
    });
    route('POST', '/orders/check-code', function (c) {
      var u = currentUser(c.db, c.ctx), b = c.body || {}, d = resolveDiscount(c.db, u, b.code), plan = b.planId ? findPlan(String(b.planId)) : null;
      return { body: { discount: d ? { percent: d.percent, code: d.code, kind: d.kind, label: d.label } : null, amount: plan ? (d ? priceAfter(plan.price, d.percent) : plan.price) : null } };
    });
    route('GET', '/orders/referral', function (c) {
      var u = currentUser(c.db, c.ctx), code = ensureReferralCode(c.db, u);
      var used = c.db.orders.filter(function (o) { return o.referrerId === u.id && o.status !== 'CANCELLED'; });
      return { body: { referral: { code: code, percent: REFERRAL_PCT, rewardCredits: u.rewardCredits || 0, friends: used.length, earned: used.filter(function (o) { return o.rewardGiven; }).length }, newStar: { code: NEW_STAR, percent: NEW_STAR_PCT } }, write: true };
    });
    function ownOrder(c, id) {
      var u = currentUser(c.db, c.ctx), o = c.db.orders.filter(function (x) { return x.id === id && x.userId === u.id; })[0];
      if (!o) throw new HttpErr(404, 'Order not found.', 'ORDER_NOT_FOUND');
      return { user: u, order: o };
    }
    route('POST', '/orders/:id/upgrade', function (c) {
      var own = ownOrder(c, c.params.id), o = own.order, planId = planIdFrom(c.body);
      if (!isActiveOrder(o)) throw new HttpErr(409, 'This plan is no longer active.', 'ORDER_CLOSED');
      var target = findPlan(planId);
      if (!target) throw new HttpErr(404, 'This plan is no longer available.', 'PLAN_NOT_FOUND');
      if (o.status === 'PAID') {
        if (stageIndex(o.stage) >= stageIndex('IN_PRODUCTION')) throw new HttpErr(409, 'Upgrades are only possible before production starts.', 'UPGRADE_TOO_LATE');
        var targetAmount = priceAfter(target.price, o.discountPercent); // the order's discount carries over
        if (targetAmount <= o.amount) throw new HttpErr(400, 'Please choose a higher plan to upgrade.', 'NOT_AN_UPGRADE');
        var open = c.db.upgrades.filter(function (u) { return u.orderId === o.id && OPEN_UPGRADE.indexOf(u.status) > -1; })[0], t = iso();
        if (open && open.status === 'PENDING') throw new HttpErr(409, 'Your upgrade payment is being verified. Please wait for the confirmation.', 'UPGRADE_IN_PROGRESS');
        var fields = { fromPlanId: o.planId, toPlanId: target.id, amount: targetAmount - o.amount, status: 'CREATED', note: null, reference: null, submittedAt: null, reviewedAt: null, updatedAt: t };
        var upg = open || { id: newId(), orderId: o.id, createdAt: t };
        Object.assign(upg, fields);
        if (!open) c.db.upgrades.push(upg);
        return { body: { requested: true, remaining: upg.amount, upgrade: publicUpgrade(upg) }, write: true };
      }
      // Not paid yet: free to switch to any plan until payment is requested.
      if (stageIndex(o.stage) >= stageIndex('PAYMENT_PENDING') || o.status === 'PAYMENT_PROCESSING') throw new HttpErr(409, 'Your plan can’t be changed once payment has been requested.', 'PLAN_LOCKED');
      if (target.id === o.planId) throw new HttpErr(400, 'You are already on this plan.', 'ALREADY_ON_PLAN');
      o.planId = target.id; o.amount = priceAfter(target.price, o.discountPercent); if (o.discountPercent) o.listPrice = target.price; o.updatedAt = iso();
      return { body: { applied: true, order: publicOrder(c.db, o) }, write: true };
    });    function ownUpgrade(c, id) {
      var u = currentUser(c.db, c.ctx), up = c.db.upgrades.filter(function (x) { return x.id === id; })[0];
      var o = up && c.db.orders.filter(function (x) { return x.id === up.orderId && x.userId === u.id; })[0];
      if (!o) throw new HttpErr(404, 'Upgrade not found.', 'NOT_FOUND');
      return { user: u, up: up, order: o };
    }
    route('GET', '/orders/upgrades/:uid', function (c) {
      var own = ownUpgrade(c, c.params.uid), plan = findPlan(own.order.planId);
      return { body: { upgrade: publicUpgrade(own.up), order: { id: own.order.id, stage: own.order.stage, status: own.order.status, amount: own.order.amount, plan: { id: plan.id, name: plan.name } },
        client: { name: own.user.name, email: own.user.email, mobile: own.user.mobile } } };
    });
    route('DELETE', '/orders/upgrades/:uid', function (c) {
      var own = ownUpgrade(c, c.params.uid);
      if (['CREATED', 'FAILED'].indexOf(own.up.status) < 0) throw new HttpErr(409, 'This upgrade can no longer be cancelled.', 'NOT_CANCELLABLE');
      own.up.status = 'CANCELLED'; own.up.updatedAt = iso();
      return { body: { ok: true }, write: true };
    });
    route('POST', '/orders/upgrades/:uid/payment-proof', function (c) {
      var b = c.body || {}, f = {}, shot = typeof b.screenshot === 'string' ? b.screenshot : '';
      if (shot.length < 100) f.screenshot = 'Attach the payment screenshot';
      var ref = String(b.reference == null ? '' : b.reference).trim();
      if (ref.length > 60) f.reference = 'Transaction ID is too long';
      if (Object.keys(f).length) throw bad(f);
      if (!proofKind(shot)) throw new HttpErr(400, 'Please attach a PNG, JPG or WEBP screenshot (up to 2 MB).', 'VALIDATION_ERROR', { screenshot: 'Attach a PNG, JPG or WEBP screenshot (up to 2 MB)' });
      var own = ownUpgrade(c, c.params.uid), up = own.up;
      if (up.status === 'PENDING') throw new HttpErr(409, 'You have already sent your payment details. We will verify them within 24 hours.', 'ALREADY_SUBMITTED');
      if (['CREATED', 'FAILED'].indexOf(up.status) < 0) throw new HttpErr(409, 'This upgrade is already finished.', 'UPGRADE_CLOSED');
      if (own.order.status !== 'PAID' || !isActiveOrder(own.order)) throw new HttpErr(409, 'This plan is no longer active.', 'ORDER_CLOSED');
      var t = iso(), proofs = loadProofs(); proofs[up.id] = shot;
      try { saveProofs(proofs); } catch (e) { throw new HttpErr(413, 'Your browser storage is full, so the screenshot could not be saved. Please use a smaller screenshot.', 'STORAGE_FULL'); }
      Object.assign(up, { status: 'PENDING', reference: ref || null, submittedAt: t, reviewedAt: null, note: null, updatedAt: t });
      return { status: 201, body: { upgrade: publicUpgrade(up) }, write: true };
    });
    route('GET', '/orders/upgrades/:uid/proof', function (c) {
      var own = ownUpgrade(c, c.params.uid), data = loadProofs()[own.up.id], mime = proofKind(data);
      if (!mime) throw new HttpErr(404, 'No screenshot found.', 'NOT_FOUND');
      return { image: { mime: mime, dataUrl: data } };
    });    route('POST', '/orders/:id/payment-proof', function (c) {
      var own = ownOrder(c, c.params.id), o = own.order, b = c.body || {}, f = {};
      var shot = typeof b.screenshot === 'string' ? b.screenshot : '';
      if (shot.length < 100) f.screenshot = 'Attach the payment screenshot';
      var ref = String(b.reference == null ? '' : b.reference).trim();
      if (ref.length > 60) f.reference = 'Transaction ID is too long';
      if (Object.keys(f).length) throw bad(f);
      var mime = proofKind(shot);
      if (!mime) throw new HttpErr(400, 'Please attach a PNG, JPG or WEBP screenshot (up to 2 MB).', 'VALIDATION_ERROR', { screenshot: 'Attach a PNG, JPG or WEBP screenshot (up to 2 MB)' });
      if (o.status === 'PAID') throw new HttpErr(409, 'This plan is already paid.', 'ALREADY_PAID');
      if (!isActiveOrder(o)) throw new HttpErr(409, 'This plan is no longer active.', 'ORDER_CLOSED');
      if (o.stage !== 'PAYMENT_PENDING') throw new HttpErr(409, 'Payment is not requested yet. STAR PRODUCTION will ask for payment after verification.', 'PAYMENT_NOT_REQUESTED');
      if (o.status === 'PAYMENT_PROCESSING') throw new HttpErr(409, 'You have already sent your payment details. We will verify them within 24 hours.', 'ALREADY_SUBMITTED');
      var t = iso(), p = c.db.payments.filter(function (x) { return x.orderId === o.id; })[0];
      if (!p) { p = { id: newId(), orderId: o.id, gateway: 'upi-qr', createdAt: t }; c.db.payments.push(p); }
      Object.assign(p, { gateway: 'upi-qr', amount: o.amount, status: 'PENDING', reference: ref || null, submittedAt: t, reviewedAt: null, note: null, updatedAt: t });
      var proofs = loadProofs(); proofs[p.id] = shot;
      try { saveProofs(proofs); } catch (e) { throw new HttpErr(413, 'Your browser storage is full, so the screenshot could not be saved. Please use a smaller screenshot.', 'STORAGE_FULL'); }
      o.status = 'PAYMENT_PROCESSING'; o.updatedAt = t;
      return { status: 201, body: { order: publicOrder(c.db, o) }, write: true };
    });
    route('GET', '/orders/:id/proof', function (c) {
      var own = ownOrder(c, c.params.id), p = c.db.payments.filter(function (x) { return x.orderId === own.order.id; })[0];
      var data = p && loadProofs()[p.id], mime = proofKind(data);
      if (!mime) throw new HttpErr(404, 'No screenshot found.', 'NOT_FOUND');
      return { image: { mime: mime, dataUrl: data } };
    });
    route('GET', '/orders', function (c) {
      var u = currentUser(c.db, c.ctx);
      return { body: { orders: c.db.orders.filter(function (o) { return o.userId === u.id; }).sort(byDateDesc('createdAt')).map(function (o) { return publicOrder(c.db, o); }) } };
    });
    route('GET', '/orders/:id/status', function (c) {
      var own = ownOrder(c, c.params.id), plan = findPlan(own.order.planId);
      return { body: { order: Object.assign(publicOrder(c.db, own.order), {
        plan: { id: plan.id, name: plan.name, price: plan.price, originalPrice: plan.originalPrice },
        client: { name: own.user.name, email: own.user.email, mobile: own.user.mobile } }) } };
    });

    /* ── chat (FAQ answers + messages to the team) ── */
    route('GET', '/chat/faqs', function () {
      var f = opts.faq && opts.faq(); if (!f) return { body: { popular: [] } };
      return { body: { popular: f.POPULAR_FAQ_IDS.map(function (id) { var q = f.FAQS.filter(function (x) { return x.id === id; })[0]; return { id: id, question: q.q }; }) } };
    });
    function optionalUser(c) { try { return currentUser(c.db, c.ctx); } catch (e) { return null; } }
    route('POST', '/chat/message', function (c) {
      var message = messageText((c.body || {}).message), f = opts.faq && opts.faq();
      var r = f ? f.answerMessage(message) : { type: 'clarify' };
      if (r.type === 'greeting' || r.type === 'thanks') return { body: { type: r.type, answer: r.answer } };
      if (r.type === 'faq') return { body: Object.assign({ type: 'faq' }, r.faq, { related: r.related }) };
      if (r.type === 'clarify') return { body: { type: 'clarify' } };
      var u = optionalUser(c);
      if (!u) return { body: { type: 'need_email' } };
      saveMessage(c.db, { userId: u.id, name: u.name, email: u.email, message: message });
      return { body: { type: 'sent' }, write: true };
    });
    route('POST', '/chat/handoff', function (c) {
      var b = c.body || {}, message = messageText(b.message), u = optionalUser(c), email = null;
      if (!u) {
        if (b.email == null || b.email === '') throw new HttpErr(400, 'Please enter your email so the team can reply.', 'VALIDATION_ERROR', { email: 'Email is required' });
        var em = checkEmail(b.email); if (em.error) throw bad({ email: em.error });
        email = em.value;
      }
      saveMessage(c.db, { userId: u && u.id, name: u ? u.name : String(b.name || '').trim().slice(0, 100), email: u ? u.email : email, message: message });
      return { body: { ok: true }, write: true };
    });
    function inbox(db, u) { return db.messages.filter(function (m) { return m.sender !== 'SYSTEM' && (m.userId === u.id || m.email === u.email); }); } // (account notices are for the admin only)
    route('GET', '/chat/inbox', function (c) {
      var u = currentUser(c.db, c.ctx);
      var messages = inbox(c.db, u).sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); }).map(function (m) {
        return { id: m.id, from: m.sender === 'ADMIN' ? 'team' : 'me', message: m.message, isNew: m.sender === 'ADMIN' && m.status === 'NEW', createdAt: m.createdAt };
      });
      return { body: { messages: messages, unread: messages.filter(function (m) { return m.isNew; }).length } };
    });
    route('POST', '/chat/inbox/read', function (c) {
      inbox(c.db, currentUser(c.db, c.ctx)).forEach(function (m) { if (m.sender === 'ADMIN' && m.status === 'NEW') m.status = 'READ'; });
      return { body: { ok: true }, write: true };
    });
    route('POST', '/chat/inbox', function (c) {
      var u = currentUser(c.db, c.ctx);
      saveMessage(c.db, { userId: u.id, name: u.name, email: u.email, message: messageText((c.body || {}).message) });
      return { body: { ok: true }, write: true };
    });

    /* ── admin ── */
    route('GET', '/admin/stats', function (c) {
      adminOnly(c.db, c.ctx);
      var db = c.db, live = db.orders.filter(isLive), n = function (ws) { return live.filter(function (o) { return o.workState === ws; }).length; };
      var revenue = db.payments.filter(function (p) { var o = db.orders.filter(function (x) { return x.id === p.orderId; })[0]; return p.status === 'SUCCESS' && o && o.status === 'PAID'; })
        .reduce(function (s, p) { return s + p.amount; }, 0);
      revenue += db.upgrades.filter(function (u) { return u.status === 'SUCCESS'; }).reduce(function (s, u) { return s + u.amount; }, 0);
      return { body: { stats: {
        totalClients: db.users.filter(function (u) { return u.role === 'CLIENT'; }).length, inReview: n('REVIEW'), inProcess: n('PROCESS'), completed: n('COMPLETED'),
        paymentIncomplete: live.filter(isPaymentIncomplete).length, totalRevenue: revenue,
        unreadMessages: db.messages.filter(function (m) { return m.sender !== 'ADMIN' && m.status === 'NEW'; }).length,
        paymentRequests: db.payments.filter(function (p) { var o = db.orders.filter(function (x) { return x.id === p.orderId; })[0]; return p.status === 'PENDING' && o && o.status === 'PAYMENT_PROCESSING'; }).length + db.upgrades.filter(function (u) { return u.status === 'PENDING'; }).length
      } } };
    });
    route('GET', '/admin/clients', function (c) {
      adminOnly(c.db, c.ctx, 'ADMIN');
      return { body: { clients: c.db.users.filter(function (u) { return u.role === 'CLIENT'; }).sort(byDateDesc('createdAt')).map(function (u) { return adminUser(c.db, u); }) } };
    });
    route('GET', '/admin/clients/:id', function (c) {
      adminOnly(c.db, c.ctx, 'ADMIN');
      var u = userById(c.db, c.params.id);
      if (!u) throw new HttpErr(404, 'Client not found.');
      return { body: { client: Object.assign(adminUser(c.db, u), { orders: c.db.orders.filter(function (o) { return o.userId === u.id; }).sort(byDateDesc('createdAt')).map(function (o) { return publicOrder(c.db, o); }) }) } };
    });
    route('POST', '/admin/clients/:id/verify-email', function (c) {
      adminOnly(c.db, c.ctx, 'ADMIN');
      return { body: { client: adminUser(c.db, findClient(c.db, c.params.id)) } };
    });
    route('PATCH', '/admin/clients/:id', function (c) {
      adminOnly(c.db, c.ctx, 'ADMIN');
      var status = (c.body || {}).status;
      if (status !== 'ACTIVE' && status !== 'BLOCKED') throw bad({ status: 'Invalid option' });
      var u = findClient(c.db, c.params.id); u.status = status; u.updatedAt = iso();
      return { body: { client: adminUser(c.db, u) }, write: true };
    });
    route('DELETE', '/admin/clients/:id', function (c) {
      adminOnly(c.db, c.ctx, 'ADMIN');
      var u = findClient(c.db, c.params.id), db = c.db, proofs = loadProofs();
      var orderIds = db.orders.filter(function (o) { return o.userId === u.id; }).map(function (o) { return o.id; });
      db.payments.filter(function (p) { return orderIds.indexOf(p.orderId) > -1; }).forEach(function (p) { delete proofs[p.id]; });
      db.upgrades.filter(function (x) { return orderIds.indexOf(x.orderId) > -1; }).forEach(function (x) { delete proofs[x.id]; });
      db.upgrades = db.upgrades.filter(function (x) { return orderIds.indexOf(x.orderId) < 0; });
      db.payments = db.payments.filter(function (p) { return orderIds.indexOf(p.orderId) < 0; });
      db.orders = db.orders.filter(function (o) { return o.userId !== u.id; });
      db.messages = db.messages.filter(function (m) { return m.userId !== u.id; });
      db.users = db.users.filter(function (x) { return x.id !== u.id; });
      saveProofs(proofs);
      return { body: { ok: true, deleted: { id: u.id, email: u.email } }, write: true };
    });
    route('POST', '/admin/clients/:id/password', function (c) {
      adminOnly(c.db, c.ctx, 'ADMIN');
      var u = findClient(c.db, c.params.id), pw = (c.body || {}).password;
      if (pw != null && pw !== '') { var pe = checkPassword(pw); if (pe) throw bad({ password: pe }); }
      else pw = Array.prototype.map.call(rnd(9), function (b) { return 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.charAt(b % 54); }).join('') + 'a1';
      u.passwordHash = hashPassword(pw, hex(8)); u.updatedAt = iso();
      return { body: { password: pw }, write: true };
    });
    route('GET', '/admin/orders', function (c) {
      adminOnly(c.db, c.ctx);
      var q = c.query, list = c.db.orders.slice();
      if (WORK_STATES.indexOf(q.workState) > -1) list = list.filter(function (o) { return isLive(o) && o.workState === q.workState; });
      if (STAGES.indexOf(q.stage) > -1) list = list.filter(function (o) { return o.stage === q.stage; });
      if (ORDER_STATUSES.indexOf(q.status) > -1) list = list.filter(function (o) { return o.status === q.status; });
      if (q.paymentIncomplete === '1') list = list.filter(function (o) { return isLive(o) && isPaymentIncomplete(o); });
      return { body: { orders: list.sort(byDateDesc('createdAt')).map(function (o) { return adminOrder(c.db, o); }) } };
    });
    function orderOr404(c) { var o = c.db.orders.filter(function (x) { return x.id === c.params.id; })[0]; if (!o) throw new HttpErr(404, 'Order not found.'); return o; }
    route('GET', '/admin/orders/:id', function (c) {
      adminOnly(c.db, c.ctx);
      var o = orderOr404(c), plan = findPlan(o.planId);
      return { body: { order: Object.assign(adminOrder(c.db, o), { plan: { id: plan.id, name: plan.name, price: plan.price, originalPrice: plan.originalPrice } }) } };
    });
    route('PATCH', '/admin/orders/:id', function (c) {
      adminOnly(c.db, c.ctx, 'ADMIN');
      var b = c.body || {}, f = {};
      if (b.stage != null && STAGES.indexOf(b.stage) < 0) f.stage = 'Invalid option';
      if (b.workState != null && WORK_STATES.indexOf(b.workState) < 0) f.workState = 'Invalid option';
      if (b.status != null && ORDER_STATUSES.indexOf(b.status) < 0) f.status = 'Invalid option';
      if (Object.keys(f).length) throw bad(f);
      if (!b.stage && !b.workState && !b.status && !b.planId) throw bad({ _: 'Nothing to update' });
      var o = orderOr404(c);
      if (b.planId) {
        var plan = findPlan(String(b.planId)); if (!plan) throw new HttpErr(404, 'That plan is not available.');
        o.planId = plan.id; o.amount = priceAfter(plan.price, o.discountPercent); if (o.discountPercent) o.listPrice = plan.price;
      }
      ['stage', 'workState', 'status'].forEach(function (k) { if (b[k]) o[k] = b[k]; });
      o.updatedAt = iso();
      return { body: { order: adminOrder(c.db, o) }, write: true };
    });
    route('GET', '/admin/payments', function (c) {
      adminOnly(c.db, c.ctx);
      var rows = c.db.payments.map(function (p) { return adminPayment(c.db, p); })
        .concat(c.db.upgrades.filter(function (u) { return u.submittedAt; }).map(function (u) { return adminUpgrade(c.db, u); }));
      rows.sort(function (a, b) { return String(b.submittedAt || b.createdAt).localeCompare(String(a.submittedAt || a.createdAt)); });
      return { body: { payments: rows } };
    });    route('GET', '/admin/payments/:id/screenshot', function (c) {
      adminOnly(c.db, c.ctx);
      var data = loadProofs()[c.params.id], mime = proofKind(data);
      if (!mime) throw new HttpErr(404, 'No screenshot found.');
      return { image: { mime: mime, dataUrl: data } };
    });
    function pendingPayment(c) {
      var p = c.db.payments.filter(function (x) { return x.id === c.params.id; })[0];
      if (!p) throw new HttpErr(404, 'Payment not found.');
      var o = c.db.orders.filter(function (x) { return x.id === p.orderId; })[0];
      if (p.status !== 'PENDING' || o.status !== 'PAYMENT_PROCESSING') throw new HttpErr(409, 'This payment is not waiting for verification.', 'NOT_PENDING');
      return { p: p, o: o };
    }
    route('POST', '/admin/payments/:id/approve', function (c) {
      adminOnly(c.db, c.ctx, 'PAYMENTS');
      var x = pendingPayment(c), t = iso();
      x.p.status = 'SUCCESS'; x.p.reviewedAt = t; x.p.note = null; x.p.updatedAt = t;
      x.o.status = 'PAID'; x.o.updatedAt = t;
      if (stageIndex(x.o.stage) <= stageIndex('PAYMENT_PENDING')) x.o.stage = 'INVOICE_ISSUED';
      // A friend's referral code was used and the order is paid → whoever shared it earns a 10% reward (once per order).
      var ref = x.o.referrerId && !x.o.rewardGiven ? userById(c.db, x.o.referrerId) : null;
      if (ref) { ref.rewardCredits = (ref.rewardCredits || 0) + 1; x.o.rewardGiven = true; }
      return { body: { payment: adminPayment(c.db, x.p) }, write: true };
    });
    route('POST', '/admin/payments/:id/reject', function (c) {
      adminOnly(c.db, c.ctx, 'PAYMENTS');
      var reason = String(((c.body || {}).reason) == null ? '' : c.body.reason).trim();
      if (!reason) throw bad({ reason: 'Write a short reason' });
      if (reason.length > 300) throw bad({ reason: 'Too long' });
      var x = pendingPayment(c), t = iso();
      x.p.status = 'FAILED'; x.p.reviewedAt = t; x.p.note = reason; x.p.updatedAt = t;
      x.o.status = 'PENDING'; x.o.updatedAt = t;
      return { body: { payment: adminPayment(c.db, x.p) }, write: true };
    });
    function pendingUpgrade(c) {
      var u = c.db.upgrades.filter(function (x) { return x.id === c.params.id; })[0];
      if (!u) throw new HttpErr(404, 'Upgrade not found.');
      if (u.status !== 'PENDING') throw new HttpErr(409, 'This payment is not waiting for verification.', 'NOT_PENDING');
      return u;
    }
    route('GET', '/admin/upgrades/:id/screenshot', function (c) {
      adminOnly(c.db, c.ctx);
      var data = loadProofs()[c.params.id], mime = proofKind(data);
      if (!mime) throw new HttpErr(404, 'No screenshot found.');
      return { image: { mime: mime, dataUrl: data } };
    });
    route('POST', '/admin/upgrades/:id/approve', function (c) {
      adminOnly(c.db, c.ctx, 'PAYMENTS');
      var u = pendingUpgrade(c), target = findPlan(u.toPlanId), t = iso();
      if (!target) throw new HttpErr(404, 'The upgrade plan no longer exists.');
      var o = c.db.orders.filter(function (x) { return x.id === u.orderId; })[0];
      Object.assign(u, { status: 'SUCCESS', reviewedAt: t, note: null, updatedAt: t });
      o.planId = target.id; o.amount = o.amount + u.amount; if (o.discountPercent) o.listPrice = target.price; o.updatedAt = t; // paid so far + the difference just paid
      return { body: { payment: adminUpgrade(c.db, u) }, write: true };
    });
    route('POST', '/admin/upgrades/:id/reject', function (c) {
      adminOnly(c.db, c.ctx, 'PAYMENTS');
      var reason = String(((c.body || {}).reason) == null ? '' : c.body.reason).trim();
      if (!reason) throw bad({ reason: 'Write a short reason' });
      if (reason.length > 300) throw bad({ reason: 'Too long' });
      var u = pendingUpgrade(c), t = iso();
      Object.assign(u, { status: 'FAILED', reviewedAt: t, note: reason, updatedAt: t });
      return { body: { payment: adminUpgrade(c.db, u) }, write: true };
    });    route('GET', '/admin/emails', function (c) {
      adminOnly(c.db, c.ctx, 'ADMIN');
      return { body: { provider: 'standalone', from: '', setup: { ok: false, provider: 'standalone', error: 'Standalone mode runs in the browser and cannot send email. Run the server for real emails.' }, logs: [] } };
    });
    route('POST', '/admin/emails/test', function (c) {
      adminOnly(c.db, c.ctx, 'ADMIN');
      return { body: { result: { ok: false, provider: 'standalone', error: 'Standalone mode cannot send email.' } } };
    });
    route('GET', '/admin/plans', function (c) {
      adminOnly(c.db, c.ctx);
      return { body: { plans: planRows().map(function (p) {
        return Object.assign(publicPlan(p), { active: true, paidOrders: c.db.orders.filter(function (o) { return o.planId === p.id && o.status === 'PAID'; }).length });
      }) } };
    });

    /* ── admin: messages ── */
    route('GET', '/admin/messages', function (c) {
      adminOnly(c.db, c.ctx);
      var only = c.query.email ? String(c.query.email).toLowerCase() : null, map = {}, order = [];
      c.db.messages.filter(function (m) { return !only || m.email === only; }).sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); }).forEach(function (m) {
        var g = map[m.email];
        if (!g) { g = map[m.email] = { key: m.email, email: m.email, name: '', userId: null, accountStatus: null, total: 0, unread: 0, lastAt: null, messages: [] }; order.push(m.email); }
        var u = m.userId && userById(c.db, m.userId);
        if (m.name && m.sender !== 'ADMIN') g.name = m.name;
        if (u) { g.userId = u.id; g.accountStatus = u.status; }
        g.total += 1;
        if (m.sender !== 'ADMIN' && m.status === 'NEW') g.unread += 1;
        g.lastAt = m.createdAt;
        g.messages.push({ id: m.id, from: m.sender === 'ADMIN' ? 'team' : m.sender === 'SYSTEM' ? 'system' : 'client', message: m.message, status: m.status, createdAt: m.createdAt });
      });
      return { body: { conversations: order.map(function (e) { return map[e]; }).sort(function (a, b) { return String(b.lastAt).localeCompare(String(a.lastAt)); }) } };
    });
    route('POST', '/admin/messages/status', function (c) {
      adminOnly(c.db, c.ctx);
      var b = c.body || {};
      if (b.status !== 'NEW' && b.status !== 'READ') throw bad({ status: 'Invalid option' });
      if (!b.id && !b.email) throw bad({ _: 'Nothing to update' });
      c.db.messages.forEach(function (m) {
        if (b.id ? m.id === b.id : (m.email === String(b.email).toLowerCase() && m.sender !== 'ADMIN')) m.status = b.status;
      });
      return { body: { ok: true }, write: true };
    });
    route('POST', '/admin/messages/reply', function (c) {
      adminOnly(c.db, c.ctx);
      var b = c.body || {}, f = {};
      var em = checkEmail(b.email); if (em.error) f.email = em.error;
      var text = String(b.message == null ? '' : b.message).trim();
      if (!text) f.message = 'Write a reply'; else if (text.length > 2000) f.message = 'Please keep the reply under 2000 characters';
      if (Object.keys(f).length) throw bad(f);
      var u = userByEmail(c.db, em.value), last = !u && c.db.messages.filter(function (m) { return m.email === em.value; }).pop();
      saveMessage(c.db, { userId: u && u.id, name: u ? u.name : (last && last.name) || '', email: em.value, message: text, sender: 'ADMIN', status: 'NEW' });
      c.db.messages.forEach(function (m) { if (m.email === em.value && m.sender !== 'ADMIN' && m.status === 'NEW') m.status = 'READ'; });
      return { status: 201, body: { ok: true }, write: true };
    });
    route('DELETE', '/admin/messages/:id', function (c) {
      adminOnly(c.db, c.ctx);
      c.db.messages = c.db.messages.filter(function (m) { return m.id !== c.params.id; });
      return { body: { ok: true }, write: true };
    });

    /* ═══════════════ dispatcher ═══════════════ */
    function parse(path) {
      var i = path.indexOf('?'), p = i < 0 ? path : path.slice(0, i), q = {};
      if (i > -1) path.slice(i + 1).split('&').forEach(function (kv) { if (!kv) return; var s = kv.split('='); q[decodeURIComponent(s[0])] = decodeURIComponent((s[1] || '').replace(/\+/g, ' ')); });
      return { path: p.replace(/^\/api/, ''), query: q };
    }
    /**
     * @param {string} method @param {string} path e.g. "/api/orders?x=1" @param {object|null} body
     * @param {{ session: { userId: string|null } }} ctx  the browser's login (kept by the caller)
     * @returns {Promise<{status:number, body?:object, image?:{mime:string,dataUrl:string}}>}
     */
    function handle(method, path, body, ctx) {
      return Promise.resolve().then(function () {
        var pr = parse(path), db = load();
        for (var i = 0; i < routes.length; i++) {
          var r = routes[i];
          if (r.method !== method) continue;
          var m = r.re.exec(pr.path);
          if (!m) continue;
          var params = {}; r.keys.forEach(function (k, j) { params[k] = decodeURIComponent(m[j + 1]); });
          var out = r.handler({ db: db, ctx: ctx, body: body, params: params, query: pr.query });
          if (out.write) { save(db); changed(); }
          return { status: out.status || 200, body: out.body, image: out.image };
        }
        return { status: 404, body: { error: { message: 'Not found.', code: 'NOT_FOUND' } } };
      }).catch(function (e) {
        if (e instanceof HttpErr) return { status: e.status, body: { error: { message: e.message, code: e.code, fields: e.fields } } };
        if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)))) {
          return { status: 413, body: { error: { message: 'Your browser storage is full. Please delete some old data and try again.', code: 'STORAGE_FULL' } } };
        }
        return { status: 500, body: { error: { message: 'Something went wrong. Please try again.', code: 'SERVER_ERROR' } } };
      });
    }

    return { handle: handle, load: load };
  }

  return { createEngine: createEngine, sha256: sha256, hashPassword: hashPassword, verifyPassword: verifyPassword };
});
