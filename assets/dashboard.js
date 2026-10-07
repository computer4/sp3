/* STAR PRODUCTION — client dashboard (dashboard.html).
   A three-dots button (top-left) opens a side panel with three sections:
     Active Plan — plan, project progress, payment, change plan / upgrade, past plans
     Message     — the whole chat with the admin
     Profile     — the client's details and password change                                              */
(function () {
  'use strict';
  var S = window.STAR, $ = S.$, $$ = S.$$, esc = S.esc, inr = S.inr, fmtDate = S.fmtDate, ARROW = S.ARROW,
    alertBox = S.alertBox, loaderHtml = S.loaderHtml, setBusy = S.setBusy, label = S.label, badge = S.badge,
    STAGES = S.STAGES, STAGE_NOTES = S.STAGE_NOTES, WORK_LABEL = S.WORK_LABEL,
    workBadge = S.workBadge, stageChecklist = S.stageChecklist, state = S.state, api = S.api,
    findPlan = S.findPlan, startPayment = S.startPayment, shell = S.shell, reduceMotion = S.reduceMotion;
  function renderAuthNav() { S.renderHeader(state.user); }
  S.headerMenu = true; // the header shows the three-dots button on this page

  var SECTIONS = [
    { id: 'plan', title: 'Active Plan', icon: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
    { id: 'messages', title: 'Message', icon: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.6A8 8 0 1 1 21 12Z"/>' },
    { id: 'profile', title: 'Profile', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>' }
  ];
  var section = (function () { var h = (location.hash || '').slice(1); return SECTIONS.some(function (s) { return s.id === h; }) ? h : 'plan'; })();
  var pname = function (id) { var p = findPlan(id); return p ? p.name : id; };

  /* ═══════════ The side panel (opened with the three dots) ═══════════ */
  var drawerBg = document.createElement('div'), drawer = document.createElement('aside');
  drawerBg.className = 'drawer-bg'; drawer.className = 'drawer';
  drawer.setAttribute('aria-label', 'Dashboard menu'); drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = '<div class="drawer-head"><span class="eyebrow">Menu</span><button class="drawer-x" type="button" aria-label="Close menu">' + S.icon('close', '', 1.8) + '</button></div>' +
    '<div class="drawer-user"><b id="drawer-name"></b><small id="drawer-mail"></small></div>' +
    '<nav class="drawer-nav" aria-label="Dashboard sections">' + SECTIONS.map(function (s) {
      return '<button class="drawer-item" type="button" data-section="' + s.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + s.icon + '</svg>' +
        '<span>' + s.title + '</span><i class="drawer-badge" id="badge-' + s.id + '" hidden></i></button>';
    }).join('') + '</nav>' +
    '<p class="drawer-foot">STAR PRODUCTION · Artist portal</p>';
  document.body.appendChild(drawerBg); document.body.appendChild(drawer);

  function openDrawer() {
    drawer.classList.add('open'); drawerBg.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
    var b = $('#dash-menu-btn'); if (b) b.setAttribute('aria-expanded', 'true');
    var cur = $('.drawer-item[aria-current="page"]', drawer) || $('.drawer-item', drawer); if (cur) setTimeout(function () { cur.focus(); }, 60);
  }
  function closeDrawer(refocus) {
    drawer.classList.remove('open'); drawerBg.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
    var b = $('#dash-menu-btn'); if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); }
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#dash-menu-btn')) { drawer.classList.contains('open') ? closeDrawer() : openDrawer(); }
  });
  drawerBg.addEventListener('click', function () { closeDrawer(true); });
  $('.drawer-x', drawer).addEventListener('click', function () { closeDrawer(true); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer(true); });
  drawer.addEventListener('keydown', function (e) { // keep Tab inside the open panel
    if (e.key !== 'Tab') return;
    var items = $$('button', drawer), first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function viewDashboard(view, r) {
    document.title = 'Dashboard — STAR PRODUCTION';
    var stop = false, timer = null, justApplied = r && r.params && r.params.get('applied'), last = null;
    state.cleanup = function () { stop = true; clearInterval(timer); };
    view.innerHTML = '<div class="page">' + loaderHtml('Loading dashboard…') + '</div>';

    function load(silent) {
      Promise.all([api('GET', '/auth/me'), api('GET', '/orders'), api('GET', '/chat/inbox').catch(function () { return { messages: [], unread: 0 }; }), api('GET', '/orders/referral').catch(function () { return null; })]).then(function (res) {
        if (stop) return;
        state.user = res[0].user; S.menuUnread = res[2].unread || 0; renderAuthNav();
        last = { u: res[0].user, orders: res[1].orders, inbox: res[2], ref: res[3] };
        draw();
        clearInterval(timer);
        timer = setInterval(function () { load(true); }, 20000); // a safety net; live updates normally arrive instantly
      }).catch(function (err) {
        if (stop || err.status === 401 || silent) return;
        view.innerHTML = shell(alertBox('error', 'We couldn’t load your dashboard.', err.message, '<button class="btn btn-secondary btn-sm" type="button" id="retry">Try again</button>'));
        $('#retry').addEventListener('click', function () { view.innerHTML = '<div class="page">' + loaderHtml('Loading dashboard…') + '</div>'; load(); });
      });
    }

    function setSection(id) {
      if (SECTIONS.every(function (s) { return s.id !== id; })) return;
      section = id;
      try { history.replaceState(null, '', '#' + id); } catch (e) { location.hash = id; }
      closeDrawer(false);
      if (last) { draw(); window.scrollTo(0, 0); }
    }
    drawer.addEventListener('click', function (e) { var b = e.target.closest('[data-section]'); if (b) setSection(b.getAttribute('data-section')); });
    // Links like dashboard.html#messages (and the browser's back button) change the section too.
    window.addEventListener('hashchange', function () { var h = (location.hash || '').slice(1); if (h !== section) setSection(h); });

    /* ── Profile: change password (the client enters the current password; the admin is informed) ── */
    function buildPasswordPanel() {
      var el = document.createElement('section');
      el.className = 'panel'; el.id = 'pw-panel'; el.style.marginTop = '24px'; el.setAttribute('aria-labelledby', 'pwt');
      function fld(name, labelText, autocomplete) {
        return '<div class="field"><label for="pw-' + name + '">' + labelText + '</label><div class="input-wrap"><input class="input" id="pw-' + name + '" name="' + name + '" type="password" autocomplete="' + autocomplete + '" required /></div>' +
          '<p class="field-error" id="pw-' + name + '-err" hidden></p></div>';
      }
      el.innerHTML = '<h2 id="pwt" class="eyebrow">Change password</h2>' +
        '<p class="faint" style="margin:10px 0 0;font-size:.85rem">Enter your current password to choose a new one. Our team is informed when you change it.</p>' +
        '<div id="pw-alert" style="margin-top:16px" hidden></div>' +
        '<form id="pw-form" novalidate style="max-width:480px;margin-top:20px">' +
          fld('currentPassword', 'Current password', 'current-password') +
          fld('newPassword', 'New password <span class="faint">(8+ characters, with a letter and a number)</span>', 'new-password') +
          fld('confirmPassword', 'Confirm new password', 'new-password') +
          '<button class="btn btn-primary btn-sm" type="submit">Change password</button></form>';
      var form = el.querySelector('#pw-form'), al = el.querySelector('#pw-alert');
      function showErr(fields) {
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(function (k) {
          var p = el.querySelector('#pw-' + k + '-err'), i = el.querySelector('#pw-' + k), m = fields && fields[k];
          p.textContent = m || ''; p.hidden = !m; if (m) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid');
        });
      }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = form.querySelector('button[type=submit]'); if (btn.disabled) return;
        var v = { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value, confirmPassword: form.confirmPassword.value }, f = {};
        if (!v.currentPassword) f.currentPassword = 'Enter your current password';
        if (!v.newPassword) f.newPassword = 'Enter a new password';
        else if (v.newPassword.length < 8) f.newPassword = 'Password must be at least 8 characters';
        else if (!/[A-Za-z]/.test(v.newPassword)) f.newPassword = 'Password must contain at least one letter';
        else if (!/\d/.test(v.newPassword)) f.newPassword = 'Password must contain at least one number';
        if (!v.confirmPassword) f.confirmPassword = 'Please confirm your new password'; else if (v.confirmPassword !== v.newPassword) f.confirmPassword = 'Passwords do not match';
        al.hidden = true; showErr(f);
        if (Object.keys(f).length) return;
        setBusy(btn, true, 'Changing…');
        api('POST', '/auth/change-password', v).then(function (res) {
          setBusy(btn, false); form.reset(); showErr({});
          al.innerHTML = alertBox('success', 'Password changed', esc(res.message || 'Your password has been changed.')); al.hidden = false;
        }).catch(function (err) {
          setBusy(btn, false);
          if (err.fields && Object.keys(err.fields).length) showErr(err.fields); else { al.innerHTML = alertBox('error', '', err.message); al.hidden = false; }
        });
      });
      return el;
    }

    /* ═══════════ Section: Active Plan ═══════════ */
    function planSection(orders, active) {
      var past = orders.filter(function (o) { return !o.active; });
      var html = '';

      if (justApplied && active) html += '<div style="margin-bottom:24px">' + alertBox('success', 'Application received', 'You applied for ' + esc(active.plan.name) + '. Follow each step of your project below.') + '</div>';

      if (!active) {
        html += '<section class="panel" aria-labelledby="ap"><h2 id="ap" class="eyebrow">Active plan</h2>' +
          '<p class="muted" style="margin-top:20px">You don’t have an active plan. Choose one below to get started.</p></section>' +
          '<section class="panel" style="margin-top:24px" aria-labelledby="tp"><h2 id="tp" class="eyebrow">Take a plan</h2>' +
          promoBox(orders.length === 0) + '<div id="apply-alert" style="margin-top:16px" hidden></div><div class="mini-plans">' + state.plans.map(function (p) {
            return '<article class="mini-plan' + (p.isFeatured ? ' featured' : '') + '"><h3>' + esc(p.name) + '</h3>' +
              '<p class="price">' + (p.originalPrice ? '<s>' + inr(p.originalPrice) + '</s>' : '') + '<b>' + inr(p.price) + '</b><span>/ song</span></p>' +
              '<p class="desc">' + esc(p.finalOutput) + '</p>' +
              '<button class="btn ' + (p.isFeatured ? 'btn-primary' : 'btn-secondary') + ' btn-sm btn-block" type="button" data-apply="' + esc(p.id) + '">Take this plan</button></article>';
          }).join('') + '</div></section>';
      } else {
        var planInfo = findPlan(active.plan.id);
        var payDue = active.stage === 'PAYMENT_PENDING' && active.status === 'PENDING';
        var verifying = active.status === 'PAYMENT_PROCESSING';
        var rejectedNote = payDue && active.payment && active.payment.status === 'FAILED' ? active.payment.note : '';
        html += '<section class="panel accent-border on" aria-labelledby="ap"><h2 id="ap" class="eyebrow">Active plan</h2>' +
          '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;margin-top:20px">' +
            '<div><p class="big-plan">' + esc(active.plan.name) + '</p>' +
            '<p class="faint" style="margin-top:8px;font-size:.88rem">' + (active.discount && active.discount.listPrice ? '<s>' + inr(active.discount.listPrice) + '</s> ' : planInfo && planInfo.originalPrice ? '<s>' + inr(planInfo.originalPrice) + '</s> ' : '') + inr(active.amount) + ' / song · Applied ' + fmtDate(active.createdAt) + '</p>' +
            (active.discount ? '<p style="margin-top:8px"><span class="save">' + esc(discountLabel(active.discount)) + '</span></p>' : '') + '</div>' +
            '<div class="badges">' + workBadge(active.workState) + badge(active.status === 'PAID' ? 'PAID' : active.paymentStatus) + '</div>' +
          '</div>' +
          (rejectedNote ? '<div style="margin-top:24px">' + alertBox('error', 'Your last payment wasn’t accepted', esc(rejectedNote) + '<br><span class="faint">Please pay again and send a clear screenshot.</span>') + '</div>' : '') +
          (verifying ? '<div style="margin-top:24px">' + alertBox('info', 'Payment sent — under verification', 'We’ll verify your payment under 24 hrs. Your dashboard updates the moment it is confirmed.', '<a class="btn btn-secondary btn-sm" href="pay.html?order_id=' + encodeURIComponent(active.id) + '">View details</a>') + '</div>' : '') +
          (active.status === 'PAID' ? '<div style="margin-top:24px">' + sendDetailsBox(active) + '</div>' : '') +
          (payDue ? '<div style="margin-top:24px">' + alertBox('info', 'Payment requested', 'Your details are verified. Pay ' + inr(active.amount) + ' by UPI to start your project.',
            '<button class="btn btn-primary btn-sm" type="button" id="pay-now">Pay now ' + inr(active.amount) + ' ' + ARROW + '</button>') + '</div><div id="pay-alert" style="margin-top:12px" hidden></div>' : '') +
          '<h3 class="eyebrow" style="margin-top:32px;color:rgba(235,235,235,.5)">Project detail</h3>' +
          '<dl class="kv" style="margin-top:8px">' +
            '<div><dt>Work in progress</dt><dd>' + esc(label(active.stage)) + '</dd></div>' +
            '<div><dt>What’s happening</dt><dd style="font-weight:500">' + esc(STAGE_NOTES[active.stage] || '') + '</dd></div>' +
            '<div><dt>Project status</dt><dd>' + esc(WORK_LABEL[active.workState]) + '</dd></div>' +
            (active.discount ? '<div><dt>Discount</dt><dd>' + esc(discountLabel(active.discount)) + (active.discount.saved ? ' — you save ' + inr(active.discount.saved) : '') + '</dd></div>' : '') +
            '<div><dt>Payment</dt><dd>' + esc(active.status === 'PAID' ? 'Paid' : active.status === 'PAYMENT_PROCESSING' ? 'Under verification' : active.stage === 'PAYMENT_PENDING' ? 'Due now' : STAGES.indexOf(active.stage) < 3 ? 'Requested after verification' : 'Not paid') + '</dd></div>' +
            (active.payment && active.payment.reference ? '<div><dt>Transaction ID</dt><dd class="mono">' + esc(active.payment.reference) + '</dd></div>' : '') +
            '<div><dt>Last update</dt><dd>' + fmtDate(active.updatedAt, true) + '</dd></div>' +
          '</dl></section>' +

          '<section class="panel" style="margin-top:24px" aria-labelledby="pp"><div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap"><h2 id="pp" class="eyebrow">Project progress</h2>' +
          '<span class="faint" style="font-size:.78rem">Step ' + (STAGES.indexOf(active.stage) + 1) + ' of ' + STAGES.length + '</span></div>' + stageChecklist(active) + '</section>' +
          changePlanSection(active);
      }

      html += '<section class="panel" style="margin-top:24px" aria-labelledby="ps"><div style="display:flex;justify-content:space-between;gap:16px"><h2 id="ps" class="eyebrow">Past subscriptions</h2><span class="faint" style="font-size:.75rem">' + past.length + ' total</span></div>' +
        (!past.length ? '<p class="muted" style="margin-top:16px;font-size:.9rem">No past subscriptions yet.</p>' :
          '<div class="table-wrap" style="margin-top:20px;border:0"><table><caption class="sr-only">Past subscriptions</caption><thead><tr><th scope="col">Plan</th><th scope="col">Amount</th><th scope="col">Final stage</th><th scope="col">Payment</th><th scope="col">Applied</th><th scope="col">Last update</th></tr></thead><tbody>' +
          past.map(function (o) {
            return '<tr><td><b>' + esc(o.plan.name) + '</b></td><td>' + inr(o.amount) + '</td><td>' + (o.status === 'CANCELLED' || o.status === 'REFUNDED' ? badge(o.status) : badge(o.stage)) + '</td>' +
              '<td>' + badge(o.status === 'PAID' ? 'PAID' : o.paymentStatus) + '</td><td class="nowrap faint">' + fmtDate(o.createdAt) + '</td><td class="nowrap faint">' + fmtDate(o.updatedAt) + '</td></tr>';
          }).join('') + '</tbody></table></div>') + '</section>';
      html += referralPanel();
      return html;
    }

    /* ── Discount codes & referrals ── */
    function discountLabel(d) {
      var what = d.kind === 'REWARD' ? 'Referral reward' : d.kind === 'REFERRAL' ? 'Referral code' : d.code || 'Discount';
      return what + ' · ' + d.percent + '% off';
    }
    function promoBox(firstOrder) {
      var ref = last && last.ref && last.ref.referral, reward = ref && ref.rewardCredits > 0;
      return '<div class="promo" style="margin-top:20px;max-width:520px"><label for="apply-code" class="faint" style="font-size:.78rem;letter-spacing:.12em;text-transform:uppercase">Promo or referral code <span style="text-transform:none;letter-spacing:0">(optional)</span></label>' +
        '<input class="input" id="apply-code" maxlength="40" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="' + (firstOrder ? 'NEW-STAR' : 'STAR-XXXXXX') + '" style="margin-top:8px" />' +
        (reward ? '<p class="faint" style="margin-top:8px;font-size:.84rem">🎁 You have a <b style="color:var(--mist)">' + ref.percent + '% referral reward</b> — it is applied automatically if you leave the code empty.</p>' : '') +
        (firstOrder ? '<p class="faint" style="margin-top:8px;font-size:.84rem">First order? Use <b style="color:var(--mist);user-select:all">NEW-STAR</b> for <b style="color:var(--mist)">15% off</b>.</p>' : '') + '</div>';
    }
    function referralPanel() {
      var r = last && last.ref && last.ref.referral; if (!r) return '';
      var msg = 'Hi! I use STAR PRODUCTION for my songs. Use my referral code ' + r.code + ' to get ' + r.percent + '% off your plan: ' + location.origin + '/';
      return '<section class="panel" style="margin-top:24px" aria-labelledby="rf"><h2 id="rf" class="eyebrow">Refer a friend — you both get ' + r.percent + '% off</h2>' +
        '<p class="faint" style="margin-top:12px;font-size:.88rem">Share your code. Your friend gets <b style="color:var(--mist)">' + r.percent + '% off</b> their plan, and when their payment is confirmed you get <b style="color:var(--mist)">' + r.percent + '% off</b> your next plan automatically.</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:18px"><code id="ref-code" style="font-size:1.35rem;letter-spacing:.14em;padding:10px 16px;border:1px dashed var(--line);user-select:all">' + esc(r.code) + '</code>' +
        '<button class="btn btn-secondary btn-sm" type="button" id="ref-copy" data-code="' + esc(r.code) + '">Copy code</button>' +
        '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(msg) + '">Share on WhatsApp</a></div>' +
        '<dl class="kv" style="margin-top:20px"><div><dt>Friends who used your code</dt><dd>' + r.friends + '</dd></div><div><dt>Rewards earned</dt><dd>' + r.earned + '</dd></div>' +
        '<div><dt>Reward ready for your next plan</dt><dd>' + (r.rewardCredits > 0 ? r.rewardCredits + ' × ' + r.percent + '% off' : 'None yet') + '</dd></div></dl></section>';
    }

    /* After the admin confirms the payment: ask the client to email their project details to the studio (one tap opens a ready-made email). */
    var STUDIO_EMAIL = 'starprod.in@gmail.com';
    function sendDetailsBox(active) {
      var u = state.user || {}, subject = 'Project details — ' + active.plan.name + ' — ' + (u.name || '') + ' (Order ' + active.id + ')';
      var body = ['Hello STAR PRODUCTION,', '', 'Here are the details for my project.', '',
        'Name: ' + (u.name || ''), 'Email: ' + (u.email || ''), 'Mobile: ' + (u.mobile || ''), 'Plan: ' + active.plan.name, 'Order ID: ' + active.id, '',
        'Song title / working title:', 'Genre & language:', 'Mood / style & reference songs (links):', 'Lyrics, demo, hum or recording (attach or link):', 'Deadline / release date:', 'Anything else we should know:', ''].join('\n');
      var href = 'mailto:' + STUDIO_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      return alertBox('success', 'Payment confirmed — now send us your project details',
        'Please email your project details to <b style="user-select:all">' + STUDIO_EMAIL + '</b> so we can start:' +
        '<ul style="margin:10px 0 0 18px;padding:0;line-height:1.7"><li>Song title, genre and language</li><li>Mood / style and reference songs</li><li>Lyrics, demo, hum or recording (attach or share a link)</li><li>Deadline or release date</li></ul>' +
        '<span class="faint" style="display:block;margin-top:10px">Mention your Order ID <span class="mono">' + esc(active.id) + '</span>. Your invoice has been emailed to you.</span>',
        '<a class="btn btn-primary btn-sm" href="' + esc(href) + '">Send project details ' + ARROW + '</a>');
    }

    /* Change plan. Not paid yet: any plan, until the admin ticks "Payment Pending". Paid: upgrade only (a second QR payment). */
    function changePlanSection(active) {
      var openUp = active.upgrade, paid = active.status === 'PAID', idx = STAGES.indexOf(active.stage);

      if (paid && openUp) {
        var pendingUp = openUp.status === 'PENDING';
        return '<section class="panel accent-border on" style="margin-top:24px" aria-labelledby="up"><h2 id="up" class="eyebrow">Plan upgrade · ' + esc(pname(openUp.fromPlanId)) + ' → ' + esc(pname(openUp.toPlanId)) + '</h2>' +
          (pendingUp
            ? '<div style="margin-top:16px">' + alertBox('info', 'Upgrade payment sent — under verification', 'We’ll verify your payment under 24 hrs. Your plan upgrades the moment it is confirmed.', '<a class="btn btn-secondary btn-sm" href="pay.html?upgrade_id=' + encodeURIComponent(openUp.id) + '">View details</a>') + '</div>'
            : (openUp.status === 'FAILED' && openUp.note ? '<div style="margin-top:16px">' + alertBox('error', 'Your last upgrade payment wasn’t accepted', esc(openUp.note) + '<br><span class="faint">Please pay again and send a clear screenshot.</span>') + '</div>' : '') +
              '<p class="faint" style="margin-top:12px;font-size:.88rem">You’ve already paid ' + inr(active.amount) + '. Pay the difference of <b style="color:var(--mist)">' + inr(openUp.amount) + '</b> by UPI to move to <b style="color:var(--mist)">' + esc(pname(openUp.toPlanId)) + '</b>.</p>' +
              '<div class="toolbar" style="margin-top:16px"><button class="btn btn-primary btn-sm" type="button" data-pay-upgrade="' + esc(openUp.id) + '">Pay now ' + inr(openUp.amount) + ' ' + ARROW + '</button>' +
              '<button class="btn btn-ghost btn-sm" type="button" data-cancel-upgrade="' + esc(openUp.id) + '">Cancel upgrade</button></div>') +
          '<div id="upgrade-alert" style="margin-top:16px" hidden></div></section>';
      }

      if (paid) {
        if (idx >= STAGES.indexOf('IN_PRODUCTION')) return '';
        var higher = state.plans.filter(function (p) { return p.price > active.amount; });
        if (!higher.length) return '';
        return '<section class="panel" style="margin-top:24px" aria-labelledby="up"><h2 id="up" class="eyebrow">Upgrade your plan</h2>' +
          '<p class="faint" style="margin:10px 0 0;font-size:.85rem">You’ve paid ' + inr(active.amount) + ' for ' + esc(active.plan.name) + '. Upgrade by paying just the difference — a second UPI payment, confirmed by our team. Available until production starts.</p>' +
          '<div id="upgrade-alert" style="margin-top:16px" hidden></div><div class="mini-plans">' + higher.map(function (p) {
            return planCard(p, '+ ' + inr(p.price - active.amount) + ' to pay', 'Upgrade — pay ' + inr(p.price - active.amount));
          }).join('') + '</div></section>';
      }

      // Not paid yet.
      if (idx >= STAGES.indexOf('PAYMENT_PENDING') || active.status === 'PAYMENT_PROCESSING') {
        return '<section class="panel" style="margin-top:24px" aria-labelledby="up"><h2 id="up" class="eyebrow">Change plan</h2>' +
          '<p class="faint" style="margin:10px 0 0;font-size:.88rem">🔒 Your plan is locked because our team has requested payment. Once your plan is paid you can upgrade it to a higher plan.</p></section>';
      }
      var others = state.plans.filter(function (p) { return p.id !== active.plan.id; });
      if (!others.length) return '';
      return '<section class="panel" style="margin-top:24px" aria-labelledby="up"><h2 id="up" class="eyebrow">Change plan</h2>' +
        '<p class="faint" style="margin:10px 0 0;font-size:.85rem">You can switch to any plan until our team asks for payment. Your price follows the plan you choose.</p>' +
        '<div id="upgrade-alert" style="margin-top:16px" hidden></div><div class="mini-plans">' + others.map(function (p) {
          var d = p.price - active.amount;
          return planCard(p, d === 0 ? 'Same price' : (d > 0 ? '+ ' : '− ') + inr(Math.abs(d)) + ' vs. your plan', 'Switch to this plan');
        }).join('') + '</div></section>';
    }
    function planCard(p, note, btnText) {
      return '<article class="mini-plan' + (p.isFeatured ? ' featured' : '') + '"><h3>' + esc(p.name) + '</h3>' +
        '<p class="price">' + (p.originalPrice ? '<s>' + inr(p.originalPrice) + '</s>' : '') + '<b>' + inr(p.price) + '</b><span>/ song</span></p>' +
        '<p class="desc">' + esc(note) + '</p>' +
        '<button class="btn btn-secondary btn-sm btn-block" type="button" data-upgrade="' + esc(p.id) + '" data-name="' + esc(p.name) + '">' + esc(btnText) + '</button></article>';
    }

    /* ═══════════ Section: Message (the whole chat with the admin) ═══════════ */
    function messagesSection(inbox) {
      var msgs = (inbox && inbox.messages) || [], day = '';
      var bubbles = msgs.map(function (m) {
        var team = m.from === 'team', d = fmtDate(m.createdAt), sep = '';
        if (d !== day) { day = d; sep = '<div class="chat-day"><span>' + esc(d) + '</span></div>'; }
        var time = new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        return sep + '<div class="cb ' + (team ? 'team' : 'me') + (m.isNew ? ' fresh' : '') + '">' +
          (team ? '<span class="cb-who">STAR PRODUCTION</span>' : '') +
          '<p>' + esc(m.message) + '</p><span class="cb-time">' + esc(time) + (m.isNew ? ' · New' : '') + '</span></div>';
      }).join('');
      return '<section class="panel chat-panel" aria-labelledby="mp">' +
        '<div class="chat-head"><div><h2 id="mp" class="eyebrow">Chat with STAR PRODUCTION</h2><p class="faint" style="margin:6px 0 0;font-size:.82rem">Ask anything the assistant can’t answer — we reply here (and by email).</p></div>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="open-bot">Ask the assistant</button></div>' +
        '<div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="Conversation">' +
          (bubbles || '<div class="chat-empty"><b>No messages yet</b><span>Say hello — our team will answer you here.</span></div>') + '</div>' +
        '<div id="inbox-alert" style="padding:0 20px" hidden></div>' +
        '<form class="chat-form" id="inbox-form"><label class="sr-only" for="inbox-text">Your message</label>' +
        '<textarea id="inbox-text" rows="1" maxlength="1000" placeholder="Type a message…"></textarea>' +
        '<button class="chat-send" type="submit" aria-label="Send message">' + ARROW + '</button></form></section>';
    }

    /* ═══════════ Section: Profile ═══════════ */
    function profileSection(u) {
      var initial = esc((u.name || '?').trim().charAt(0).toUpperCase());
      return '<section class="panel profile-card" aria-labelledby="pf"><h2 id="pf" class="eyebrow">Profile</h2>' +
        '<div class="profile-top"><span class="avatar" aria-hidden="true">' + initial + '</span><div><b class="profile-name">' + esc(u.name) + '</b><span class="faint">' + esc(u.email) + '</span></div></div>' +
        '<dl class="kv" style="margin-top:24px">' +
          '<div><dt>Name</dt><dd>' + esc(u.name) + '</dd></div><div><dt>Email</dt><dd>' + esc(u.email) + '</dd></div>' +
          '<div><dt>Mobile</dt><dd>' + esc(u.mobile || '—') + '</dd></div><div><dt>Member since</dt><dd>' + fmtDate(u.createdAt) + '</dd></div>' +
          '<div><dt>Account</dt><dd>' + badge(u.status) + '</dd></div></dl></section><div id="pw-slot"></div>';
    }

    /* ── "Verify your email" notice (until the client clicks the link we emailed) ── */
    var resent = false;
    function verifyBanner(u) {
      if (u.emailVerified) { resent = false; return ''; }
      return '<div id="verify-banner" style="margin-bottom:24px">' + alertBox('info', 'Verify your email address',
        '<span>' + (resent ? 'We just sent a new verification link to <b>' + esc(u.email) + '</b>. Open it to confirm.' :
          'We sent a verification link to <b>' + esc(u.email) + '</b>. Open it to confirm — you’ll need a verified email before you can pay, and your invoice is sent there.') + '</span>',
        resent ? '' : '<button class="btn btn-secondary btn-sm" type="button" id="resend-verify">Resend email</button>') + '</div>';
    }

    /* ═══════════ Draw the current section ═══════════ */
    function draw() {
      var u = last.u, orders = last.orders, inbox = last.inbox;
      var savedY = window.scrollY; // the page redraws itself on live updates — stay where the client is reading
      var keptPw = $('#pw-panel'); // the password form is kept as it is across refreshes (so nothing typed is lost)
      var draftEl = $('#inbox-text'), draft = draftEl ? draftEl.value : '', hadFocus = draftEl && document.activeElement === draftEl;
      var log0 = $('#chat-log'), stick = !log0 || log0.scrollHeight - log0.scrollTop - log0.clientHeight < 80; // keep the chat pinned to the bottom if it was
      if (stickNext) { stick = true; stickNext = false; }
      var active = orders.filter(function (o) { return o.active; })[0] || null;
      var cur = SECTIONS.filter(function (s) { return s.id === section; })[0];
      document.body.classList.toggle('in-chat', section === 'messages'); // the floating assistant button steps aside here

      var body = section === 'messages' ? messagesSection(inbox) : section === 'profile' ? profileSection(u) : planSection(orders, active);
      view.innerHTML = shell(
        '<header class="dash-head"><p class="eyebrow">Artist Dashboard · ' + esc(cur.title) + '</p><h1 class="page-title dash-title">' + (section === 'plan' ? 'Welcome, ' + esc(u.name) : esc(cur.title)) + '</h1></header>' +
        '<div class="dash-body">' + verifyBanner(u) + body + '</div>');

      // side panel: who, which section, unread
      $('#drawer-name').textContent = u.name; $('#drawer-mail').textContent = u.email;
      $$('.drawer-item', drawer).forEach(function (b) { if (b.getAttribute('data-section') === section) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      var bm = $('#badge-messages'); if (bm) { bm.hidden = !(inbox && inbox.unread); bm.textContent = inbox && inbox.unread ? String(inbox.unread) : ''; }

      var slot = $('#pw-slot'); if (slot) slot.replaceWith(keptPw || buildPasswordPanel());
      if (section === 'messages') {
        var log = $('#chat-log'); if (log && stick) log.scrollTop = log.scrollHeight;
        if (inbox && inbox.unread) api('POST', '/chat/inbox/read').catch(function () {}); // opening the chat marks the team's replies as read
      } else if (savedY > 0) window.scrollTo(0, savedY);

      // Resend the verification email
      var rv = $('#resend-verify');
      if (rv) rv.addEventListener('click', function () {
        setBusy(rv, true, 'Sending…');
        api('POST', '/auth/resend-verification').then(function () { resent = true; draw(); }).catch(function (err) {
          setBusy(rv, false); var vb = $('#verify-banner'); if (vb) vb.insertAdjacentHTML('beforeend', '<div style="margin-top:12px">' + alertBox('error', '', err.message) + '</div>');
        });
      });

      // Pay now
      var payBtn = $('#pay-now');
      if (payBtn) payBtn.addEventListener('click', function () { startPayment(active.id, payBtn, $('#pay-alert')); });

      // Change plan / upgrade
      $$('[data-upgrade]', view).forEach(function (b) {
        b.addEventListener('click', function () {
          var a = $('#upgrade-alert');
          if (!confirm('Change to ' + b.getAttribute('data-name') + '?')) return;
          setBusy(b, true, 'Working…');
          api('POST', '/orders/' + encodeURIComponent(active.id) + '/upgrade', { planId: b.getAttribute('data-upgrade') }).then(function (res) {
            // A paid plan: straight to the QR payment for the difference.
            if (res.requested && res.upgrade) { location.href = 'pay.html?upgrade_id=' + encodeURIComponent(res.upgrade.id); return; }
            justApplied = false; load();
          }).catch(function (err) { setBusy(b, false); a.innerHTML = alertBox('error', '', err.message); a.hidden = false; load(true); });
        });
      });
      $$('[data-pay-upgrade]', view).forEach(function (b) { b.addEventListener('click', function () { location.href = 'pay.html?upgrade_id=' + encodeURIComponent(b.getAttribute('data-pay-upgrade')); }); });
      $$('[data-cancel-upgrade]', view).forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Cancel this upgrade? You keep your current plan.')) return;
          setBusy(b, true, '…');
          api('DELETE', '/orders/upgrades/' + encodeURIComponent(b.getAttribute('data-cancel-upgrade'))).then(function () { load(); }).catch(function (err) {
            setBusy(b, false); var a = $('#upgrade-alert'); a.innerHTML = alertBox('error', '', err.message); a.hidden = false;
          });
        });
      });
      $$('[data-apply]', view).forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.disabled) return;
          setBusy(b, true, 'Applying…');
          var codeBox = $('#apply-code'), code = codeBox ? codeBox.value.trim() : '';
          api('POST', '/orders', { planId: b.getAttribute('data-apply'), code: code }).then(function () {
            justApplied = true; load();
            window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
          }).catch(function (err) {
            setBusy(b, false);
            var a = $('#apply-alert'); a.innerHTML = alertBox('error', '', err.message); a.hidden = false;
          });
        });
      });

      var copyBtn = $('#ref-copy');
      if (copyBtn) copyBtn.addEventListener('click', function () {
        var c = copyBtn.getAttribute('data-code'), done = function () { copyBtn.textContent = 'Copied ✓'; setTimeout(function () { copyBtn.textContent = 'Copy code'; }, 2000); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c).then(done, function () { var s = window.getSelection(), r = document.createRange(); r.selectNodeContents($('#ref-code')); s.removeAllRanges(); s.addRange(r); });
        else { var s = window.getSelection(), r = document.createRange(); r.selectNodeContents($('#ref-code')); s.removeAllRanges(); s.addRange(r); }
      });

      // Chat: restore an unsent draft, Enter sends (Shift+Enter = new line), open the assistant
      var box = $('#inbox-text');
      if (box) {
        if (draft) box.value = draft;
        if (hadFocus) box.focus();
        var grow = function () { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 140) + 'px'; box.style.overflowY = box.scrollHeight > 140 ? 'auto' : 'hidden'; };
        box.addEventListener('input', grow); grow();
        box.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#inbox-form').requestSubmit(); } });
      }
      var ob = $('#open-bot'); if (ob) ob.addEventListener('click', function () { if (window.StarChat) window.StarChat.open(); });
      var inboxForm = $('#inbox-form');
      if (inboxForm) inboxForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = $('button[type=submit]', inboxForm), text = box.value.trim(), al = $('#inbox-alert');
        if (!text) { box.focus(); return; }
        btn.disabled = true;
        api('POST', '/chat/inbox', { message: text }).then(function () { box.value = ''; stickNext = true; load(); }).catch(function (err) {
          btn.disabled = false; al.innerHTML = alertBox('error', '', err.message); al.hidden = false;
        });
      });
    }
    var stickNext = false; // after sending, the chat jumps to the newest message

    load();
    S.live(function () { load(true); }); // instant updates pushed by the server
  }

  var view = $('#view');
  view.innerHTML = '<div class="page">' + loaderHtml('Loading dashboard…') + '</div>';
  S.requireUser().then(function () { return S.loadPlans(); }).then(function () {
    viewDashboard(view, { params: new URLSearchParams(location.search) });
  }).catch(function (err) { view.innerHTML = shell(alertBox('error', 'We couldn’t load your dashboard.', err.message)); });
})();
