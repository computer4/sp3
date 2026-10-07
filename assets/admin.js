/* STAR PRODUCTION — admin control room (admin.html).
   Main admin (role ADMIN): projects, clients (every detail), messages, payments (view only), emails, plans — cannot confirm payments.
   Payments admin (role PAYMENTS): projects (view only), messages, payments — confirms or rejects them.
   Both: the overview numbers (projects, clients, revenue) and replying to clients.                                   */
(function () {
  'use strict';
  var S = window.STAR, $ = S.$, $$ = S.$$, esc = S.esc, inr = S.inr, fmtDate = S.fmtDate, icon = S.icon, ARROW = S.ARROW,
    alertBox = S.alertBox, loaderHtml = S.loaderHtml, setBusy = S.setBusy, label = S.label, badge = S.badge,
    STAGES = S.STAGES, WORK_STATES = S.WORK_STATES, STAGE_NOTES = S.STAGE_NOTES, WORK_LABEL = S.WORK_LABEL,
    workBadge = S.workBadge, payBadge = S.payBadge, stageChecklist = S.stageChecklist, state = S.state, api = S.api,
    findPlan = S.findPlan, startPayment = S.startPayment, shell = S.shell, reduceMotion = S.reduceMotion;
  function renderAuthNav() { S.renderHeader(state.user); }

  function viewAdmin(view) {
    document.title = 'Admin — STAR PRODUCTION';
    var role = state.user && state.user.role, isMain = role === 'ADMIN', isPay = role === 'PAYMENTS';
    var TABS = isMain
      ? [['projects', 'Projects'], ['clients', 'Clients'], ['messages', 'Messages'], ['payments', 'Payments'], ['emails', 'Emails'], ['plans', 'Plans']]
      : [['projects', 'Projects'], ['messages', 'Messages'], ['payments', 'Payments']];
    var tab = 'projects', rows = [], query = '', filter = { work: '', stage: '', incomplete: false }, openDetailRef = null;

    view.innerHTML = shell('<p class="eyebrow">' + (isMain ? 'Main admin' : 'Payments admin') + '</p><h1 class="page-title" style="margin-top:16px">Control Room</h1>' +
      '<p class="muted" style="margin-top:14px;max-width:640px;font-size:.92rem">' + (isMain ? 'You see every client detail. Payments are confirmed by the payments admin.' : 'You see client payments and confirm them. Client details are managed by the main admin.') + '</p>' +
      '<div id="verify-banner" style="margin-top:32px" hidden></div>' +
      '<h2 class="eyebrow" style="margin-top:40px;color:rgba(235,235,235,.5)">Projects</h2>' +
      '<div class="counters">' +
        '<button type="button" class="counter" data-count="REVIEW"><span>In review</span><b id="c-review">—</b><small>Not started yet</small></button>' +
        '<button type="button" class="counter" data-count="PROCESS"><span>In process</span><b id="c-process">—</b><small>Being worked on</small></button>' +
        '<button type="button" class="counter" data-count="COMPLETED"><span>Completed</span><b id="c-completed">—</b><small>Finished projects</small></button>' +
      '</div>' +
      '<dl class="stats three" id="stats" style="margin-top:12px"><div><dt>Total clients</dt><dd>—</dd></div>' +
        '<div><dt>Payment incomplete</dt><dd><button type="button" class="text-btn" style="font:inherit;font-family:var(--display);font-size:1.9rem;color:var(--mist)" data-count="INCOMPLETE">—</button></dd></div><div><dt>Total revenue</dt><dd>—</dd></div></dl>' +
      '<div id="admin-detail" style="margin-top:32px" hidden></div>' +
      '<div class="tabs" role="tablist" aria-label="Admin sections">' + TABS.map(function (t) {
        return '<button class="tab" role="tab" type="button" id="tab-' + t[0] + '" data-tab="' + t[0] + '" aria-controls="admin-panel">' + t[1] + '</button>';
      }).join('') + '</div><div id="admin-panel" role="tabpanel" style="margin-top:28px"></div>' + passwordPanelHtml());
    var panel = $('#admin-panel'), detail = $('#admin-detail');

    /* ── My account: change my own password (needs the current one) ── */
    function passwordPanelHtml() {
      function fld(name, text, ac) {
        return '<div class="field"><label for="apw-' + name + '">' + text + '</label><div class="input-wrap"><input class="input" id="apw-' + name + '" name="' + name + '" type="password" autocomplete="' + ac + '" required /></div>' +
          '<p class="field-error" id="apw-' + name + '-err" hidden></p></div>';
      }
      return '<details class="panel" id="admin-pw" style="margin-top:40px"><summary class="eyebrow" style="cursor:pointer">Change my password</summary>' +
        '<p class="faint" style="margin:14px 0 0;font-size:.85rem">Enter your current password to choose a new one. Other devices are signed out.</p>' +
        '<div id="apw-alert" style="margin-top:16px" hidden></div>' +
        '<form id="apw-form" novalidate style="max-width:480px;margin-top:20px">' +
          fld('currentPassword', 'Current password', 'current-password') +
          fld('newPassword', 'New password <span class="faint">(8+ characters, with a letter and a number)</span>', 'new-password') +
          fld('confirmPassword', 'Confirm new password', 'new-password') +
        '<button class="btn btn-primary btn-sm" type="submit">Change password</button></form></details>';
    }
    (function () {
      var form = $('#apw-form'), al = $('#apw-alert');
      function showErr(fields) {
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(function (k) {
          var p = $('#apw-' + k + '-err'), i = $('#apw-' + k), m = fields && fields[k];
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
    })();

    var lastRequests = null, lastMail = '';
    function toast(text) {
      var el = document.createElement('div');
      el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = '🔔 ' + text;
      document.body.appendChild(el);
      setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 400); }, 5000);
    }
    function loadStats() {
      api('GET', '/admin/stats').then(function (r) {
        var s = r.stats, dd = $$('#stats dd');
        $('#c-review').textContent = s.inReview; $('#c-process').textContent = s.inProcess; $('#c-completed').textContent = s.completed;
        dd[0].textContent = s.totalClients; $('[data-count="INCOMPLETE"]').textContent = s.paymentIncomplete; dd[2].textContent = inr(s.totalRevenue);
        var vb = $('#verify-banner'), pt = $('#tab-payments');
        if (pt) pt.innerHTML = 'Payments' + (s.paymentRequests ? ' <span class="badge wait" style="margin-left:6px">' + s.paymentRequests + (isPay ? ' to verify' : ' waiting') + '</span>' : '');
        if (vb) {
          vb.hidden = !s.paymentRequests || !isPay; // the banner is for the admin who can act on it
          vb.innerHTML = s.paymentRequests ? '<div class="alert info" role="status" style="align-items:center">' + icon('info', '', 1.8) +
            '<div><b>' + s.paymentRequests + ' payment verification request' + (s.paymentRequests > 1 ? 's' : '') + '</b><div class="a-body">Clients sent payment screenshots that need your confirmation.</div></div>' +
            '<div class="a-action"><button class="btn btn-primary btn-sm" type="button" data-go-payments>Review now</button></div></div>' : '';
        }
        // A new request arrives while this page is open → toast + tab-title count.
        if (isPay && lastRequests !== null && s.paymentRequests > lastRequests) toast('New payment verification request');
        lastRequests = s.paymentRequests;
        document.title = (s.paymentRequests ? '(' + s.paymentRequests + ') ' : '') + 'Admin — STAR PRODUCTION';
        var mt = $('#tab-messages');
        if (mt) mt.innerHTML = 'Messages' + (s.unreadMessages ? ' <span class="badge work" style="margin-left:6px">' + s.unreadMessages + ' new</span>' : '');
      }).catch(function () {});
    }
    function selectTab(t) {
      tab = t;
      $$('.tab', view).forEach(function (b) { var on = b.getAttribute('data-tab') === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      panel.setAttribute('aria-labelledby', 'tab-' + t);
      load();
    }
    $$('.tab', view).forEach(function (b) { b.addEventListener('click', function () { selectTab(b.getAttribute('data-tab')); }); });
    $('.tabs', view).addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = TABS.map(function (t) { return t[0]; }).indexOf(tab), n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
      selectTab(n); $('#tab-' + n).focus();
    });
    // "Review now" in the payment-request banner.
    view.addEventListener('click', function (e) {
      if (!e.target.closest('[data-go-payments]')) return;
      selectTab('payments');
      $('.tabs', view).scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
    // Counter tiles filter the project list.
    $$('[data-count]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-count');
        filter = { work: k === 'INCOMPLETE' ? '' : k, stage: '', incomplete: k === 'INCOMPLETE' };
        selectTab('projects');
        $('.tabs', view).scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
    });

    function url() {
      if (tab === 'projects') {
        var q = [];
        if (filter.work) q.push('workState=' + filter.work);
        if (filter.stage) q.push('stage=' + filter.stage);
        if (filter.incomplete) q.push('paymentIncomplete=1');
        return '/admin/orders' + (q.length ? '?' + q.join('&') : '');
      }
      return '/admin/' + tab;
    }
    function load() {
      panel.innerHTML = '<div style="display:flex;gap:12px;align-items:center;padding:40px 0" class="muted" role="status"><span class="spinner"></span> Loading…</div>';
      var myTab = tab;
      api('GET', url()).then(function (res) {
        if (myTab !== tab) return;
        rows = tab === 'emails' ? res : (res.orders || res.clients || res.payments || res.plans || res.conversations || []);
        draw();
        if (openDetailRef && openDetailRef.kind === 'chat') showChat(openDetailRef.id, true);
      }).catch(function (err) {
        panel.innerHTML = alertBox('error', '', err.message, '<button class="btn btn-secondary btn-sm" type="button" data-reload>Retry</button>');
      });
      loadStats();
    }
    function refreshAll() { load(); if (openDetailRef && openDetailRef.kind !== 'chat') (openDetailRef.kind === 'order' ? showOrder : showClient)(openDetailRef.id); }

    function table(head, body) { return '<div class="table-wrap"><table><thead><tr>' + head.map(function (h) { return '<th scope="col">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>'; }
    function who(c) { return '<b>' + esc(c && c.name) + '</b><div class="sub">' + esc(c && c.email) + '</div>'; }
    function viewBtn(kind, id) { return '<button class="text-btn" type="button" data-view-' + kind + '="' + esc(id) + '">View</button>'; }
    function stageSelect(o) {
      return '<label><span class="sr-only">Stage for ' + esc(o.plan.name) + '</span><select class="input" data-stage="' + esc(o.id) + '"' + (o.status === 'CANCELLED' || o.status === 'REFUNDED' ? ' disabled' : '') + '>' +
        STAGES.map(function (s, i) { return '<option value="' + s + '"' + (s === o.stage ? ' selected' : '') + '>' + (i + 1) + '. ' + label(s) + '</option>'; }).join('') + '</select></label>';
    }
    function workButtons(o) {
      function b(to, text, primary) { return '<button class="text-btn" type="button" data-work="' + to + '" data-id="' + esc(o.id) + '"' + (primary ? '' : ' style="color:rgba(235,235,235,.7)"') + '>' + text + '</button>'; }
      if (o.status === 'CANCELLED' || o.status === 'REFUNDED') return '<span class="faint" style="font-size:.8rem">' + esc(label(o.status)) + '</span>';
      if (o.workState === 'REVIEW') return b('PROCESS', 'Run ▶', true);
      if (o.workState === 'PROCESS') return b('COMPLETED', 'Complete ✓', true) + b('REVIEW', '↺ Back to review');
      return b('REVIEW', '↺ Back to review');
    }
    function projectRows(list, withClient) {
      return list.map(function (o) {
        return '<tr>' + (withClient ? '<td>' + who(o.client) + '</td>' : '<td class="nowrap faint">' + fmtDate(o.createdAt) + '</td>') +
          '<td class="nowrap"><b>' + esc(o.plan.name) + '</b><div class="sub">' + inr(o.amount) + (o.discount ? ' · ' + esc(o.discount.code === 'REWARD' ? 'Reward' : o.discount.code) + ' −' + o.discount.percent + '%' : '') + '</div></td>' +
          '<td>' + (isMain ? stageSelect(o) : badge(o.stage)) + '</td><td>' + payBadge(o) + '</td><td>' + workBadge(o.workState) + '</td>' +
          '<td><div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">' + (isMain ? workButtons(o) : '') + (withClient ? viewBtn('order', o.id) : '') + '</div></td></tr>';
      }).join('');
    }

    function draw() {
      var html = '';
      if (tab === 'projects') {
        html += '<div class="toolbar"><label class="faint" for="f-work" style="font-size:.8rem">Show</label><select class="input" id="f-work" style="width:auto">' +
          [['', 'All projects'], ['REVIEW', 'In review'], ['PROCESS', 'In process'], ['COMPLETED', 'Completed'], ['INCOMPLETE', 'Payment incomplete']].map(function (o) {
            var on = filter.incomplete ? o[0] === 'INCOMPLETE' : o[0] === filter.work;
            return '<option value="' + o[0] + '"' + (on ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select>' +
          '<label class="faint" for="f-stage" style="font-size:.8rem">Stage</label><select class="input" id="f-stage" style="width:auto"><option value="">Any stage</option>' +
          STAGES.map(function (s) { return '<option value="' + s + '"' + (s === filter.stage ? ' selected' : '') + '>' + label(s) + '</option>'; }).join('') + '</select>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-reload>Refresh</button></div>';
        html += !rows.length ? '<p class="muted" style="padding:32px 0">No projects here.</p>' :
          table(['Client', 'Plan', 'Stage (from the list)', 'Payment', 'Project', 'Actions'], projectRows(rows, true));
      } else if (tab === 'clients') {
        var list = rows.filter(function (c) { return (c.name + ' ' + c.email + ' ' + c.mobile).toLowerCase().indexOf(query.toLowerCase()) > -1; });
        html += '<div class="toolbar"><label for="q" class="sr-only">Search clients</label><input class="input" id="q" style="max-width:340px;padding:10px 14px;font-size:.9rem" placeholder="Search name, email or mobile" value="' + esc(query) + '" /></div>';
        html += !list.length ? '<p class="muted" style="padding:32px 0">No clients found.</p>' : table(['Name', 'Email', 'Mobile', 'Password', 'Joined', 'Plans', 'Account', 'Actions'],
          list.map(function (c) {
            return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.email) + (c.emailVerified ? '' : '<div><span class="badge wait" title="The client has not clicked the verification link">Email unverified</span></div>') + '</td><td class="nowrap">' + esc(c.mobile || '—') + '</td>' +
              '<td class="nowrap"><span class="faint" title="Passwords are stored encrypted and can’t be read">••••••••</span><div><button class="text-btn" type="button" data-set-password="' + esc(c.id) + '">Set new</button></div></td>' +
              '<td class="nowrap faint">' + fmtDate(c.createdAt) + '</td><td>' + (c.orderCount || 0) + '</td><td>' + badge(c.status) + '</td>' +
              '<td><div style="display:flex;gap:16px;flex-wrap:wrap">' + viewBtn('client', c.id) + '<button class="text-btn" type="button" data-view-client="' + esc(c.id) + '" data-focus="reply">Message</button>' +
              '<button class="text-btn" type="button" data-block="' + esc(c.id) + '">' + (c.status === 'BLOCKED' ? 'Unblock' : 'Block') + '</button>' +
              '<button class="text-btn" type="button" style="color:rgba(235,235,235,.7)" data-delete="' + esc(c.id) + '">Delete</button></div></td></tr>';
          }).join(''));
      } else if (tab === 'messages') {
        html += '<p class="muted" style="margin-bottom:16px;font-size:.9rem">Questions sent from the website chat that the FAQs don’t cover — one row per client. Reply from your own email.</p>';
        html += '<div class="toolbar"><button class="btn btn-ghost btn-sm" type="button" data-reload>Refresh</button></div>';
        html += !rows.length ? '<p class="muted" style="padding:32px 0">No messages yet.</p>' : table(['Client', 'Latest message', 'Messages', 'Last', 'Actions'],
          rows.map(function (c) {
            var last = c.messages[c.messages.length - 1];
            return '<tr><td><b>' + esc(c.name || 'Guest') + '</b><div class="sub">' + esc(c.email) + '</div></td>' +
              '<td style="max-width:360px">' + (last.from === 'system' ? '🔐 ' : '') + esc(last.message.length > 110 ? last.message.slice(0, 110) + '…' : last.message) + '</td>' +
              '<td class="nowrap">' + c.total + (c.unread ? ' <span class="badge work" style="margin-left:6px">' + c.unread + ' new</span>' : '') + '</td>' +
              '<td class="nowrap faint">' + fmtDate(c.lastAt, true) + '</td>' +
              '<td><button class="text-btn" type="button" data-view-chat="' + esc(c.key) + '">Open</button></td></tr>';
          }).join(''));
      } else if (tab === 'payments') {
        var waiting = rows.filter(function (p) { return p.status === 'PENDING'; });
        html += '<p class="muted" style="margin-bottom:16px;font-size:.9rem">' + (isPay ? 'Clients pay your UPI QR and send a screenshot. Check the money arrived in your account, then <b>Confirm</b> — the client’s dashboard unlocks instantly. Waiting requests are listed first.' : 'Every client payment. Payments are confirmed by the payments admin — you can see their status and screenshots here.') + '</p>';
        rows = waiting.concat(rows.filter(function (p) { return p.status !== 'PENDING'; }));
        html += !rows.length ? '<p class="muted" style="padding:32px 0">No payments yet.</p>' : table(['Sent', 'Client', 'Plan', 'Amount', 'Status', 'Transaction ID', 'Screenshot', 'Action'],
          rows.map(function (p) {
            var o = p.order || {};
            var act = p.status === 'PENDING' && isPay
              ? '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start"><button class="btn btn-primary btn-sm" type="button" data-pay-approve="' + esc(p.id) + '" data-kind="' + esc(p.kind || 'PLAN') + '">' + (p.kind === 'UPGRADE' ? 'Confirm upgrade payment' : 'Confirm payment') + '</button>' +
                '<button class="text-btn" type="button" style="color:rgba(235,235,235,.7)" data-pay-reject="' + esc(p.id) + '" data-kind="' + esc(p.kind || 'PLAN') + '">Reject…</button></div>'
              : (p.status === 'PENDING' ? '<span class="faint" style="font-size:.8rem">Waiting for the payments admin</span>' : '') + (o.id ? viewBtn('order', o.id) : '');
            return '<tr' + (p.status === 'PENDING' ? ' style="background:color-mix(in oklab, var(--accent) 8%, transparent)"' : '') + '><td class="nowrap faint">' + fmtDate(p.submittedAt || p.createdAt, true) + '</td><td>' + who(o.client) + '</td><td class="nowrap">' + esc(o.plan) + '</td>' +
              '<td class="nowrap">' + inr(p.amount) + '</td><td>' + (p.status === 'PENDING' ? '<span class="badge wait">Needs verification</span>' : badge(p.status)) + (p.note ? '<div class="warn">⚠ ' + esc(p.note) + '</div>' : '') + '</td>' +
              '<td class="mono faint">' + esc(p.reference || '—') + '</td>' +
              '<td>' + (p.hasProof ? '<img data-path="' + esc((p.screenshotUrl || '').replace(/^\/api/, '')) + '" alt="Payment screenshot" title="Click to enlarge" style="width:64px;height:64px;object-fit:cover;border:1px solid var(--line-strong);cursor:zoom-in" hidden />' : '<span class="faint">—</span>') + '</td>' +
              '<td>' + act + '</td></tr>';
          }).join(''));      } else if (tab === 'emails') {
        var em = rows || {}, sup = em.setup || {};
        var how = em.provider === 'brevo' ? 'Brevo (HTTPS API)' : em.provider === 'smtp' ? 'SMTP (e.g. Gmail)' : em.provider === 'standalone' ? 'Standalone (none)' : 'None — emails are only printed on the server';
        html += alertBox(sup.ok ? 'success' : 'error', sup.ok ? 'Email is set up' : 'Email is not working yet',
          '<span>Sending with <b>' + esc(how) + '</b>' + (em.from ? ' as <b>' + esc(em.from) + '</b>' : '') + '.' +
          (sup.ok ? '' : '<br>' + esc(sup.error || 'No email provider is configured.') +
            '<br><span class="faint">Gmail: use an App Password in <code>EMAIL_API_KEY</code>. If your host blocks SMTP (many free plans do), set <code>BREVO_API_KEY</code> instead — see DEPLOY.md.</span>') + '</span>');
        html += '<form class="toolbar" id="mail-test-form" style="margin-top:20px" novalidate><label class="sr-only" for="mail-to">Send a test email to</label>' +
          '<input class="input" id="mail-to" type="email" style="max-width:340px" placeholder="Send a test email to…" value="' + esc(state.user.email) + '" />' +
          '<button class="btn btn-primary btn-sm" type="submit">Send test email</button><button class="btn btn-ghost btn-sm" type="button" data-reload>Refresh log</button></form>';
        html += '<div id="mail-result" style="margin-bottom:16px">' + (lastMail ? lastMail : '') + '</div>';
        html += !(em.logs || []).length ? '<p class="muted" style="padding:24px 0">No emails sent yet.</p>' : table(['Time', 'To', 'Subject', 'Via', 'Result'],
          em.logs.map(function (l) {
            return '<tr><td class="nowrap faint">' + fmtDate(l.createdAt, true) + '</td><td>' + esc(l.to) + '</td><td style="max-width:320px">' + esc(l.subject) + '</td><td class="nowrap faint">' + esc(l.provider) + '</td>' +
              '<td>' + (l.status === 'SENT' && l.provider !== 'console' ? '<span class="badge good">Sent</span>' : l.status === 'FAILED' ? '<span class="badge bad">Failed</span>' : '<span class="badge wait">Not sent</span>') +
              (l.error ? '<div class="warn" style="max-width:360px">' + esc(l.error) + '</div>' : '') + '</td></tr>';
          }).join(''));      } else if (tab === 'plans') {
        html += '<p class="muted" style="margin-bottom:20px;font-size:.9rem">Plans & prices live in <code>data/plans.js</code>. START.bat loads changes into the database on every start.</p>';
        html += table(['ID', 'Name', 'Original', 'Price', 'Paid'], rows.map(function (p) {
          return '<tr><td class="mono faint">' + esc(p.id) + '</td><td><b>' + esc(p.name) + '</b></td><td><s class="faint">' + inr(p.originalPrice) + '</s></td><td>' + inr(p.price) + ' / ' + esc(p.unit) + '</td><td>' + p.paidOrders + '</td></tr>';
        }).join(''));
      }
      panel.innerHTML = '<div id="admin-alert" style="margin-bottom:16px" hidden></div>' + html;
      S.fillProofs(panel);
    }
    function fail(err) { var a = $('#admin-alert') || detail; a.innerHTML = alertBox('error', '', err.message); a.hidden = false; }

    /* ── Detail panels ── */
    function kv(pairs) { return '<dl class="kv">' + pairs.map(function (p) { return '<div><dt>' + p[0] + '</dt><dd' + (p[2] ? ' class="mono"' : '') + '>' + p[1] + '</dd></div>'; }).join('') + '</dl>'; }
    function openDetail(title, body, ref) {
      openDetailRef = ref;
      detail.innerHTML = '<section class="panel accent-border on" aria-labelledby="detail-title" tabindex="-1">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px"><h2 id="detail-title" class="eyebrow">' + title + '</h2>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-close-detail>Close ✕</button></div>' + body + '</section>';
      if (detail.hidden) {
        detail.hidden = false;
        detail.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        detail.firstElementChild.focus({ preventScroll: true });
      }
    }
    function showOrder(id) {
      api('GET', '/admin/orders/' + encodeURIComponent(id)).then(function (res) {
        var o = res.order, p = o.payment || {}, c = o.client || {};
        openDetail('Project — ' + esc(o.plan.name) + ' · ' + esc(c.name),
          '<div class="dash-grid" style="margin-top:12px;grid-template-columns:1fr">' +
          '<div class="two">' +
            '<div>' + kv([
              ['Client', esc(c.name)], ['Email', esc(c.email)], ['Mobile', esc(c.mobile || '—')],
              ['Plan', esc(o.plan.name)], ['Amount', inr(o.amount) + (o.discount && o.discount.listPrice ? ' <s class="faint">' + inr(o.discount.listPrice) + '</s>' : o.plan.originalPrice ? ' <s class="faint">' + inr(o.plan.originalPrice) + '</s>' : '')],
              ['Discount', o.discount ? esc((o.discount.kind === 'REWARD' ? 'Referral reward' : o.discount.kind === 'REFERRAL' ? 'Referral code ' + o.discount.code : o.discount.code) + ' — ' + o.discount.percent + '% off' + (o.discount.saved ? ' (saved ' + inr(o.discount.saved) + ')' : '')) : '<span class="faint">None</span>'],
              ['Applied', fmtDate(o.createdAt, true)], ['Last update', fmtDate(o.updatedAt, true)], ['Order ID', esc(o.id), 1]
            ]) + '</div>' +
            '<div>' + kv([
              ['Stage', badge(o.stage)], ['Project', workBadge(o.workState)], ['Payment', payBadge(o)],
              ['Method', esc(p.method || (p.id ? 'UPI QR' : '—'))], ['Transaction ID', esc(p.reference || '—'), 1],
              ['Amount received', p.status === 'SUCCESS' ? inr(p.amount) : '—'], ['Note', esc(p.note || '—')]
            ]) + '</div>' +
          '</div>' +
          (isMain
            ? '<div class="toolbar" style="margin-top:8px"><span class="faint" style="font-size:.8rem">Move to stage</span>' + stageSelect(o) +
              '<span class="faint" style="font-size:.8rem;margin-left:12px">Plan</span><label><span class="sr-only">Change plan</span><select class="input" data-plan="' + esc(o.id) + '"' + (o.status === 'CANCELLED' || o.status === 'REFUNDED' ? ' disabled' : '') + '>' +
                state.plans.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === o.plan.id ? ' selected' : '') + '>' + esc(p.name) + ' · ' + inr(p.price) + '</option>'; }).join('') + '</select></label>' +
              '<span class="faint" style="font-size:.8rem;margin-left:12px">Project</span>' + workButtons(o) + '</div>'
            : '') +
          (p.status === 'PENDING'
            ? '<div class="toolbar" style="margin-top:8px">' + (isPay
                ? '<button class="btn btn-primary btn-sm" type="button" data-pay-approve="' + esc(p.id) + '">Confirm payment</button><button class="text-btn" type="button" data-pay-reject="' + esc(p.id) + '">Reject…</button>'
                : '<span class="faint" style="font-size:.85rem">Waiting for the payments admin to confirm this payment.</span>') + '</div>'
            : '') +          (p.hasProof ? '<div style="margin-top:12px"><span class="faint" style="font-size:.8rem">Payment screenshot</span><div style="margin-top:8px"><img data-shot="' + esc(p.id) + '" alt="Payment screenshot" style="max-width:260px;max-height:260px;border:1px solid var(--line-strong);cursor:zoom-in" hidden /></div></div>' : '') +
          '<div><h3 class="eyebrow" style="margin-top:16px;color:rgba(235,235,235,.5)">What the client sees</h3>' + stageChecklist(o) + '</div>' +
          '</div>', { kind: 'order', id: id });
      }).catch(fail);
    }
    /* ── Conversation with a client (their questions + our replies) ── */
    function threadHtml(msgs) {
      if (!msgs.length) return '<p class="muted" style="margin-top:12px;font-size:.9rem">No messages yet.</p>';
      return '<div style="margin-top:12px;display:grid;gap:10px;max-height:420px;overflow-y:auto;padding-right:4px">' + msgs.map(function (m) {
        var team = m.from === 'team', sys = m.from === 'system', fresh = !team && m.status === 'NEW';
        return '<div style="justify-self:' + (team ? 'end' : 'start') + ';max-width:min(560px,92%);border:1px solid ' + (team ? 'var(--accent)' : 'var(--line-strong)') + ';' +
          (team ? 'background:color-mix(in oklab, var(--accent) 14%, transparent);' : '') + (fresh ? 'border-left:3px solid var(--accent);' : '') + 'padding:12px 14px">' +
          '<div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px"><span class="faint" style="font-size:.76rem">' + (team ? '<b style="color:var(--accent-soft)">You (STAR PRODUCTION)</b>' : sys ? '<b style="color:#ffb454">🔐 Account notice</b>' : '<b>Client</b>') + ' · ' + fmtDate(m.createdAt, true) + (fresh ? ' · <b style="color:var(--accent-soft)">New</b>' : '') + '</span>' +
          '<span style="display:flex;gap:12px">' + (team ? '' : '<button class="text-btn" type="button" data-msg-status="' + esc(m.id) + '" data-to="' + (fresh ? 'READ' : 'NEW') + '">' + (fresh ? 'Mark read' : 'Mark unread') + '</button>') +
          '<button class="text-btn" type="button" style="color:rgba(235,235,235,.7)" data-msg-delete="' + esc(m.id) + '">Delete</button></span></div>' +
          '<p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">' + esc(m.message) + '</p></div>';
      }).join('') + '</div>';
    }
    function replyBox(email) {
      return '<div style="margin-top:16px"><label class="faint" for="reply-text" style="font-size:.8rem">Reply to this client</label>' +
        '<textarea class="input" id="reply-text" rows="3" maxlength="2000" style="margin-top:8px;resize:vertical" placeholder="Write your answer…"></textarea>' +
        '<div class="toolbar" style="margin-top:10px"><button class="btn btn-primary btn-sm" type="button" data-reply-send="' + esc(email) + '">Send reply</button>' +
        '<span class="faint" style="font-size:.78rem">Shown in the client’s dashboard and sent to their email.</span></div></div>';
    }
    function showChat(key, quiet) {
      var c = rows.filter(function (r) { return r.key === key; })[0];
      if (!c) { detail.hidden = true; detail.innerHTML = ''; openDetailRef = null; return; }
      openDetail('Messages — ' + esc(c.name || c.email),
        kv([['Name', esc(c.name || 'Guest')], ['Email', '<a class="link" href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>'],
          ['Account', c.userId ? 'Registered client' : 'Guest (no account)'], ['Messages', String(c.total)]]) +
        (c.userId && isMain ? '<div class="toolbar" style="margin-top:16px"><button class="btn btn-ghost btn-sm" type="button" data-view-client="' + esc(c.userId) + '">View client</button>' +
          (c.unread ? '<button class="btn btn-ghost btn-sm" type="button" data-chat-readall="' + esc(c.email) + '">Mark all read</button>' : '') + '</div>' :
          (c.unread ? '<div class="toolbar" style="margin-top:16px"><button class="btn btn-ghost btn-sm" type="button" data-chat-readall="' + esc(c.email) + '">Mark all read</button></div>' : '')) +
        threadHtml(c.messages) + replyBox(c.email), { kind: 'chat', id: key });
      // Opening a conversation marks the client's messages as read.
      if (!quiet && c.unread) {
        api('POST', '/admin/messages/status', { email: c.email, status: 'READ' }).then(function () { load(); }).catch(function () {});
      }
    }    function showClient(id) {
      api('GET', '/admin/clients/' + encodeURIComponent(id)).then(function (res) {
        return api('GET', '/admin/messages?email=' + encodeURIComponent(res.client.email)).then(function (m) { return [res.client, m.conversations[0]]; });
      }).then(function (pair) {
        var c = pair[0], conv = pair[1];
        openDetail('Client — ' + esc(c.name), kv([
          ['Name', esc(c.name)], ['Email', '<a class="link" href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a> ' + (c.emailVerified ? '<span class="badge good">Verified</span>' : '<span class="badge wait">Unverified</span> <button class="text-btn" type="button" data-verify-email="' + esc(c.id) + '">Mark verified</button>')], ['Mobile', esc(c.mobile || '—')],
          ['Password', '<span class="faint" style="font-weight:500">Stored encrypted — can’t be read</span> <button class="text-btn" type="button" data-set-password="' + esc(c.id) + '">Set new password</button>'],
          ['Joined', fmtDate(c.createdAt, true)], ['Account', badge(c.status)], ['Plans', String(c.orders.length)]
        ]) + '<div id="pw-result" style="margin-top:12px" hidden></div>' +
          '<div class="toolbar" style="margin-top:20px"><button class="btn btn-secondary btn-sm" type="button" data-block="' + esc(c.id) + '">' + (c.status === 'BLOCKED' ? 'Unblock' : 'Block') + ' client</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-delete="' + esc(c.id) + '">Delete client</button></div>' +
          '<h3 class="eyebrow" style="margin-top:28px;color:rgba(235,235,235,.5)">Messages</h3>' + threadHtml(conv ? conv.messages : []) + replyBox(c.email) +
          (c.orders.length ? '<h3 class="eyebrow" style="margin-top:20px;color:rgba(235,235,235,.5)">Plans & projects</h3><div style="margin-top:12px">' +
            table(['Applied', 'Plan', 'Stage', 'Payment', 'Project', 'Actions'], projectRows(c.orders.map(function (o) { return Object.assign({ client: c }, o); }), false)) + '</div>'
            : '<p class="muted" style="margin-top:20px">No plans yet.</p>'), { kind: 'client', id: id });
      }).catch(fail);
    }

    /* ── Actions (event delegation for the tables and the detail panel) ── */
    function patchOrder(id, body, el) {
      if (el) el.disabled = true;
      api('PATCH', '/admin/orders/' + encodeURIComponent(id), body).then(refreshAll).catch(function (err) { if (el) el.disabled = false; fail(err); refreshAll(); });
    }
    function onChange(e) {
      var t = e.target, id;
      if (t.id === 'f-work') { filter.incomplete = t.value === 'INCOMPLETE'; filter.work = filter.incomplete ? '' : t.value; return load(); }
      if (t.id === 'f-stage') { filter.stage = t.value; return load(); }
      if ((id = t.getAttribute('data-stage'))) patchOrder(id, { stage: t.value }, t);
      if ((id = t.getAttribute('data-plan'))) {
        var chosen = findPlan(t.value);
        if (!confirm('Change this project to ' + (chosen ? chosen.name + ' (' + inr(chosen.price) + ')' : 'the selected plan') + '? The order amount changes to the new plan’s price.')) return refreshAll();
        patchOrder(id, { planId: t.value }, t);
      }
    }
    function findRow(id) { return rows.filter(function (r) { return r.id === id; })[0]; }
    function onClick(e) {
      var t = e.target.closest('button'); if (!t) return;
      var id, c;
      if (t.hasAttribute('data-reload')) return load();
      if (t.hasAttribute('data-close-detail')) { detail.hidden = true; detail.innerHTML = ''; openDetailRef = null; return; }
      if ((id = t.getAttribute('data-view-order'))) return showOrder(id);
      if ((id = t.getAttribute('data-view-client'))) { showClient(id); if (t.getAttribute('data-focus') === 'reply') setTimeout(function () { var r = $('#reply-text'); if (r) r.focus(); }, 600); return; }
      if ((id = t.getAttribute('data-view-chat'))) return showChat(id);
      if ((id = t.getAttribute('data-reply-send'))) {
        var box = $('#reply-text'), text = box && box.value.trim();
        if (!text) { box.focus(); return; }
        setBusy(t, true, 'Sending…');
        return api('POST', '/admin/messages/reply', { email: id, message: text }).then(refreshAll).catch(function (err) { setBusy(t, false); fail(err); });
      }
      if ((id = t.getAttribute('data-verify-email'))) {
        if (!confirm('Mark this client’s email address as verified?\n\nDo this only if you know the address is theirs (for example, they wrote to you from it).')) return;
        setBusy(t, true, '…');
        return api('POST', '/admin/clients/' + encodeURIComponent(id) + '/verify-email').then(refreshAll).catch(function (err) { setBusy(t, false); fail(err); });
      }
      if ((id = t.getAttribute('data-set-password'))) {
        c = findRow(id) || { name: 'this client' };
        if (!confirm('Set a new password for ' + c.name + '?\n\nThe old password stops working and they are signed out everywhere. You will see the new password once.')) return;
        setBusy(t, true, '…');
        return api('POST', '/admin/clients/' + encodeURIComponent(id) + '/password', {}).then(function (res) {
          setBusy(t, false);
          var out = $('#pw-result');
          if (!out) { openDetailRef = null; showClient(id); alert('New password for ' + c.name + ': ' + res.password + '\n\nCopy it now — it is shown only once.'); return; }
          out.innerHTML = alertBox('success', 'New password set', 'Give this to the client: <code style="user-select:all;font-size:1.05rem">' + esc(res.password) + '</code><br><span class="faint">Copy it now — it is shown only once. They can change it later with “Forgot password”.</span>');
          out.hidden = false;
        }).catch(function (err) { setBusy(t, false); fail(err); });
      }
      if ((id = t.getAttribute('data-chat-readall'))) {
        return api('POST', '/admin/messages/status', { email: id, status: 'READ' }).then(load).catch(fail);
      }
      if ((id = t.getAttribute('data-msg-status'))) {
        return api('POST', '/admin/messages/status', { id: id, status: t.getAttribute('data-to') }).then(load).catch(fail);
      }
      if ((id = t.getAttribute('data-msg-delete'))) {
        if (!confirm('Delete this message permanently?')) return;
        return api('DELETE', '/admin/messages/' + encodeURIComponent(id)).then(load).catch(fail);
      }
      if (t.hasAttribute('data-work')) { setBusy(t, true, '…'); return patchOrder(t.getAttribute('data-id'), { workState: t.getAttribute('data-work') }); }
      if (t.hasAttribute('data-go-payments')) { selectTab('payments'); $('.tabs', view).scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); return; }
      if ((id = t.getAttribute('data-pay-approve'))) {
        if (!confirm(t.getAttribute('data-kind') === 'UPGRADE' ? 'Confirm that this upgrade payment arrived in your account?\n\nThe client’s plan switches to the higher plan.' : 'Confirm that this payment arrived in your account?\n\nThe client’s plan becomes Paid and their project moves on.')) return;
        setBusy(t, true, 'Confirming…');
        return api('POST', (t.getAttribute('data-kind') === 'UPGRADE' ? '/admin/upgrades/' : '/admin/payments/') + encodeURIComponent(id) + '/approve').then(refreshAll).catch(function (err) { setBusy(t, false); fail(err); refreshAll(); });
      }
      if ((id = t.getAttribute('data-pay-reject'))) {
        var reason = prompt('Why is this payment being rejected? The client will see this.\n(e.g. “Amount received does not match”)');
        if (!reason || !reason.trim()) return;
        return api('POST', (t.getAttribute('data-kind') === 'UPGRADE' ? '/admin/upgrades/' : '/admin/payments/') + encodeURIComponent(id) + '/reject', { reason: reason.trim() }).then(refreshAll).catch(function (err) { fail(err); });
      }      if ((id = t.getAttribute('data-block'))) {
        c = findRow(id) || { status: /Unblock/.test(t.textContent) ? 'BLOCKED' : 'ACTIVE', name: 'this client' };
        var block = c.status !== 'BLOCKED';
        if (!confirm((block ? 'Block ' : 'Unblock ') + c.name + '?' + (block ? ' They will be signed out and that email can’t log in or sign up again.' : ''))) return;
        setBusy(t, true, '…');
        return api('PATCH', '/admin/clients/' + encodeURIComponent(id), { status: block ? 'BLOCKED' : 'ACTIVE' }).then(refreshAll).catch(function (err) { setBusy(t, false); fail(err); });
      }
      if ((id = t.getAttribute('data-delete'))) {
        c = findRow(id) || { name: 'this client' };
        if (!confirm('Delete ' + c.name + (c.email ? ' (' + c.email + ')' : '') + ' permanently?\n\nTheir account, plans, project history and payment records will be removed. The email can then sign up again from zero. This cannot be undone.')) return;
        setBusy(t, true, 'Deleting…');
        return api('DELETE', '/admin/clients/' + encodeURIComponent(id)).then(function () {
          if (openDetailRef && openDetailRef.kind === 'client' && openDetailRef.id === id) { detail.hidden = true; detail.innerHTML = ''; openDetailRef = null; }
          refreshAll();
        }).catch(function (err) { setBusy(t, false); fail(err); });
      }
    }
    panel.addEventListener('submit', function (e) {
      if (e.target.id !== 'mail-test-form') return;
      e.preventDefault();
      var to = $('#mail-to').value.trim(), btn = $('button[type=submit]', e.target);
      if (!to) { $('#mail-to').focus(); return; }
      setBusy(btn, true, 'Sending…');
      api('POST', '/admin/emails/test', { to: to }).then(function (res) {
        var r = res.result || {};
        lastMail = r.ok ? alertBox('success', 'Email sent', 'Accepted for delivery to <b>' + esc(to) + '</b> (via ' + esc(r.provider) + '). Check the inbox — and the spam folder.')
          : alertBox('error', 'The email was not sent', esc(r.error || 'Unknown error'));
        load();
      }).catch(function (err) { setBusy(btn, false); lastMail = alertBox('error', 'The email was not sent', err.message); load(); });
    });
    [panel, detail].forEach(function (el) {
      el.addEventListener('change', onChange); el.addEventListener('click', onClick);
      el.addEventListener('click', function (e) { var im = e.target.closest && e.target.closest('img[data-shot],img[data-path]'); if (im && im.src) window.open(im.src, '_blank'); });
    });
    panel.addEventListener('input', function (e) { if (e.target.id === 'q') { query = e.target.value; var pos = e.target.selectionStart; draw(); var q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); } });
    selectTab('projects');
    // Instant updates pushed by the server — but never while the admin is typing a reply.
    S.live(function () {
      var a = document.activeElement;
      if (a && /^(TEXTAREA|INPUT)$/.test(a.tagName) && a.value) return;
      refreshAll();
    });
  }


  var view = $('#view');
  view.innerHTML = '<div class="page">' + loaderHtml('Loading…') + '</div>';
  S.requireUser('STAFF').then(function () { return S.loadPlans(); }).then(function () {
    viewAdmin(view);
  }).catch(function (err) { view.innerHTML = shell(alertBox('error', 'We couldn’t open the admin panel.', err.message)); });
})();
