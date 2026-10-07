/* STAR PRODUCTION — payment page (pay.html): the UPI QR with a 5-minute timer, and "send payment confirmation to admin".
   Used for both payments:  pay.html?order_id=…   (the plan)   and   pay.html?upgrade_id=…   (the difference when upgrading a paid plan). */
(function () {
  'use strict';
  var S = window.STAR, $ = S.$, esc = S.esc, inr = S.inr, fmtDate = S.fmtDate, alertBox = S.alertBox, setBusy = S.setBusy, api = S.api, shell = S.shell;
  var QR_IMAGE = 'Photos/Payment/UPI-QR.jpg';
  var QR_SECONDS = 5 * 60;
  var params = new URLSearchParams(location.search);
  var upgradeId = params.get('upgrade_id'), orderId = params.get('order_id');
  var isUpgrade = !!upgradeId, subjectId = isUpgrade ? upgradeId : orderId;
  var view = $('#view'), ticker = null, deadlineKey = 'star.pay.deadline.' + (isUpgrade ? 'u.' : '') + subjectId;

  view.innerHTML = '<div class="page">' + S.loaderHtml('Loading your payment…') + '</div>';
  document.title = (isUpgrade ? 'Upgrade payment' : 'Pay') + ' — STAR PRODUCTION';

  /* ── Timer: a deadline stored for this tab, so reloading the page doesn't hand out extra time ── */
  function getDeadline() { try { return +sessionStorage.getItem(deadlineKey) || 0; } catch (e) { return 0; } }
  function setDeadline(t) { try { sessionStorage.setItem(deadlineKey, String(t)); } catch (e) {} }
  function startTimer() { setDeadline(Date.now() + QR_SECONDS * 1000); }
  function stopTimer() { clearInterval(ticker); ticker = null; }

  function statusCard(tone, icon, title, bodyHtml, actions) {
    return shell('<div class="status-wrap-inline"><div class="status-card ' + (tone || '') + '" style="margin:0 auto;margin-top:calc(var(--nav-h) - 20px)">' +
      '<div class="status-icon">' + S.icon(icon, '', 1.6) + '</div><h1>' + esc(title) + '</h1><div class="msg">' + bodyHtml + '</div>' +
      '<div class="actions" style="margin-top:28px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">' + (actions || '') + '</div></div></div>');
  }
  var planName = function (id) { var p = S.findPlan(id); return p ? p.name : id; };

  /* ── One normalized description of "what is being paid", for both kinds ── */
  function describe(res) {
    if (!isUpgrade) {
      var o = res.order, p = o.payment || {};
      var state = o.status === 'PAID' ? 'paid' : o.status === 'PAYMENT_PROCESSING' ? 'verifying' : o.stage !== 'PAYMENT_PENDING' ? 'notdue' : 'payable';
      return { state: state, amount: o.amount, label: o.plan.name, client: o.client, refId: o.id, refLabel: 'Order ID', reference: p.reference, submittedAt: p.submittedAt,
        rejected: p.status === 'FAILED' && p.note ? p.note : '', proofPath: '/orders/' + o.id + '/proof', submitPath: '/orders/' + o.id + '/payment-proof' };
    }
    var u = res.upgrade, from = planName(u.fromPlanId), to = planName(u.toPlanId);
    var st = u.status === 'SUCCESS' ? 'paid' : u.status === 'PENDING' ? 'verifying' : u.status === 'CANCELLED' ? 'cancelled' : 'payable';
    return { state: st, amount: u.amount, label: 'Upgrade: ' + from + ' → ' + to, from: from, to: to, client: res.client, refId: u.id, refLabel: 'Upgrade ID', reference: u.reference, submittedAt: u.submittedAt,
      rejected: u.status === 'FAILED' && u.note ? u.note : '', proofPath: '/orders/upgrades/' + u.id + '/proof', submitPath: '/orders/upgrades/' + u.id + '/payment-proof' };
  }

  function load(first) {
    var path = isUpgrade ? '/orders/upgrades/' + encodeURIComponent(subjectId) : '/orders/' + encodeURIComponent(subjectId) + '/status';
    return api('GET', path).then(function (res) { draw(describe(res), first); }).catch(function (err) {
      stopTimer();
      view.innerHTML = shell('<div style="max-width:640px;margin-top:40px">' + alertBox('error', 'We couldn’t open this payment.', err.message) +
        '<a class="btn btn-secondary" style="margin-top:24px" href="dashboard.html">Go to dashboard</a></div>');
    });
  }

  function draw(m, first) {
    if (m.state === 'paid') {
      stopTimer();
      view.innerHTML = statusCard('ok', 'check', isUpgrade ? 'Upgrade confirmed' : 'Payment confirmed',
        (isUpgrade
          ? '<p>Thank you! We’ve confirmed your payment of <b>' + inr(m.amount) + '</b>. Your plan is now <b>' + esc(m.to) + '</b>.</p>'
          : '<p>Thank you! We’ve confirmed your payment of <b>' + inr(m.amount) + '</b> for <b>' + esc(m.label) + '</b>. Your project has moved on — you can follow every step on your dashboard.</p>') +
        '<p class="faint" id="countdown" style="margin-top:12px;font-size:.85rem"></p>',
        '<a class="btn btn-primary" href="dashboard.html">Go to dashboard ' + S.ARROW + '</a>');
      var n = 5, c = $('#countdown');
      ticker = setInterval(function () { n -= 1; if (c) c.textContent = 'Taking you to your dashboard in ' + n + 's…'; if (n <= 0) location.href = 'dashboard.html'; }, 1000);
      if (c) c.textContent = 'Taking you to your dashboard in ' + n + 's…';
      return;
    }
    if (m.state === 'verifying') {
      stopTimer();
      view.innerHTML = statusCard('', 'clock', 'Payment details sent',
        '<p><b>We’ll verify your payment under 24 hrs</b></p><p class="faint" style="margin-top:10px;font-size:.9rem">You don’t need to do anything else. When our team confirms it, this page and your dashboard update by themselves.</p>' +
        '<div class="kv" style="margin-top:22px"><div><dt>' + (isUpgrade ? 'Upgrade' : 'Plan') + '</dt><dd>' + esc(isUpgrade ? m.from + ' → ' + m.to : m.label) + '</dd></div><div><dt>Amount</dt><dd>' + inr(m.amount) + '</dd></div>' +
        (m.reference ? '<div><dt>Transaction ID</dt><dd class="mono">' + esc(m.reference) + '</dd></div>' : '') +
        '<div><dt>Sent</dt><dd>' + fmtDate(m.submittedAt, true) + '</dd></div></div>' +
        '<div style="margin-top:20px"><img data-path="' + esc(m.proofPath) + '" alt="Your payment screenshot" style="max-width:100%;max-height:260px;border:1px solid var(--line-strong)" hidden /></div>',
        '<a class="btn btn-primary" href="dashboard.html">Go to dashboard</a>');
      S.fillProofs(view);
      return;
    }
    if (m.state === 'cancelled') {
      stopTimer();
      view.innerHTML = statusCard('', 'close', 'Upgrade cancelled', '<p>This upgrade was cancelled. You can choose an upgrade again from your dashboard.</p>', '<a class="btn btn-primary" href="dashboard.html">Go to dashboard</a>');
      return;
    }
    if (m.state === 'notdue') {
      stopTimer();
      view.innerHTML = statusCard('', 'clock', 'Payment isn’t due yet',
        '<p>Our team is still verifying your details. When payment is due, a <b>Pay now</b> button appears on your dashboard.</p>',
        '<a class="btn btn-primary" href="dashboard.html">Go to dashboard</a>');
      return;
    }
    drawPayForm(m, first);
  }

  /* ── Pay: QR + timer + "send confirmation" ── */
  function drawPayForm(m, first) {
    if (first && !getDeadline()) startTimer();
    view.innerHTML = shell(
      '<a class="faint" style="font-size:.72rem;font-weight:800;letter-spacing:.25em;text-transform:uppercase" href="dashboard.html">← Dashboard</a>' +
      '<h1 class="page-title" style="margin-top:24px">' + (isUpgrade ? 'Pay for your upgrade' : 'Pay by UPI') + '</h1>' +
      (S.state.user && S.state.user.emailVerified === false ? '<div id="verify-warn" style="margin-top:28px">' + alertBox('info', 'Verify your email first', '<span>Open the verification link we sent to <b>' + esc(S.state.user.email) + '</b> — you’ll need it before you can send your payment confirmation.</span>', '<button class="btn btn-secondary btn-sm" type="button" id="resend-verify">Resend email</button>') + '</div>' : '') +
      (m.rejected ? '<div style="margin-top:28px">' + alertBox('error', 'Your last payment wasn’t accepted', esc(m.rejected) + '<br><span class="faint">Please pay again and send a clear screenshot.</span>') + '</div>' : '') +
      '<div class="checkout-grid">' +
        '<section class="panel" aria-labelledby="qr-title" style="text-align:center">' +
          '<p class="eyebrow" id="qr-title">' + (isUpgrade ? 'Scan to pay the upgrade difference' : 'Scan to pay') + '</p>' +
          '<p class="pay-amount">' + inr(m.amount) + '</p>' +
          '<p class="faint" style="font-size:.85rem;margin-top:6px">Pay exactly this amount · works with any UPI app (Google Pay, PhonePe, Paytm, BHIM…)</p>' +
          '<div id="qr-zone"></div>' +
          '<div class="timer-wrap" id="timer-wrap"><span class="timer-label">QR valid for</span><b class="timer" id="timer">05:00</b>' +
            '<div class="timer-bar"><i id="timer-bar"></i></div></div>' +

          // Right under the timer: send the payment confirmation (screenshot) to the admin.
          '<div class="confirm-box"><h3 class="eyebrow" style="color:var(--accent-soft)">Paid? Send your confirmation to the admin</h3>' +
          '<p class="faint" style="font-size:.82rem;margin-top:8px">Attach a screenshot of your payment. We’ll verify it' + (isUpgrade ? ' and upgrade your plan.' : ' and unlock your dashboard.') + '</p>' +
          '<div id="proof-alert" style="margin-top:14px" hidden></div>' +
          '<form id="proof-form" novalidate>' +
            '<div class="field"><label for="proof-file">Payment screenshot</label>' +
            '<input class="input" id="proof-file" name="screenshot" type="file" accept="image/png,image/jpeg,image/webp" required />' +
            '<p class="field-error" id="proof-file-err" hidden></p></div>' +
            '<img id="proof-preview" alt="Screenshot preview" hidden style="max-width:100%;max-height:200px;margin:0 0 16px;border:1px solid var(--line-strong)" />' +
            '<div class="field"><label for="proof-ref">Transaction / UTR ID <span class="faint">(optional)</span></label>' +
            '<input class="input" id="proof-ref" name="reference" type="text" maxlength="60" autocomplete="off" placeholder="e.g. 4123 4567 8901" /></div>' +
            '<button class="btn btn-primary btn-block" type="submit">Send payment confirmation ' + S.ARROW + '</button>' +
          '</form></div>' +
        '</section>' +
        '<aside class="panel summary accent-border on" style="background:var(--ink);height:fit-content" aria-labelledby="sum-title">' +
          '<h2 id="sum-title" class="eyebrow">' + (isUpgrade ? 'Upgrade summary' : 'Order summary') + '</h2>' +
          '<dl>' + (isUpgrade
              ? '<div><dt>From</dt><dd>' + esc(m.from) + '</dd></div><div><dt>To</dt><dd><b>' + esc(m.to) + '</b></dd></div>'
              : '<div><dt>Plan</dt><dd><b>' + esc(m.label) + '</b></dd></div>') +
          '<div><dt>Artist</dt><dd>' + esc(m.client.name) + '</dd></div><div><dt>Email</dt><dd>' + esc(m.client.email) + '</dd></div>' +
          '<div><dt>' + esc(m.refLabel) + '</dt><dd class="mono" style="font-size:.75rem">' + esc(m.refId) + '</dd></div></dl>' +
          '<div class="sep" style="margin:22px 0;height:1px;background:var(--line)"></div>' +
          '<div class="total"><span class="muted" style="font-size:.9rem">' + (isUpgrade ? 'Difference to pay' : 'Total') + '</span><strong>' + inr(m.amount) + '</strong></div>' +
          '<p class="secure" style="margin-top:20px;font-size:.82rem;color:var(--faint)">After you pay, send the screenshot under the timer. Our team verifies it, ' + (isUpgrade ? 'then your plan is upgraded.' : 'then your dashboard unlocks.') + '</p>' +
        '</aside>' +
      '</div>');

    renderQr();
    startTicking();
    bindForm(m);
    var rv = $('#resend-verify');
    if (rv) rv.addEventListener('click', function () {
      setBusy(rv, true, 'Sending…');
      api('POST', '/auth/resend-verification').then(function () { $('#verify-warn').innerHTML = alertBox('success', 'Email sent', 'Check your inbox for the new verification link.'); }).catch(function (e) { setBusy(rv, false); $('#verify-warn').innerHTML = alertBox('error', '', e.message); });
    });
  }

  function renderQr() {
    var zone = $('#qr-zone'), left = remaining();
    if (!zone) return;
    if (left > 0) {
      zone.innerHTML = '<div class="qr-box"><img src="' + QR_IMAGE + '" alt="UPI QR code — scan with any UPI app to pay" width="320" height="320" /></div>';
    } else {
      zone.innerHTML = '<div class="qr-box expired"><p><b>This QR has expired</b></p><p class="faint" style="font-size:.85rem;margin:6px 0 16px">For your security the QR is shown for 5 minutes.</p>' +
        '<button class="btn btn-primary btn-sm" type="button" id="qr-again">Show QR again</button></div>';
      $('#qr-again').addEventListener('click', function () { startTimer(); renderQr(); startTicking(); });
    }
  }
  function remaining() { return Math.max(0, Math.ceil((getDeadline() - Date.now()) / 1000)); }
  function startTicking() { stopTimer(); wasLeft = null; tick(); ticker = setInterval(tick, 500); }
  var wasLeft = null;
  function tick() {
    var t = $('#timer'), bar = $('#timer-bar'), wrap = $('#timer-wrap');
    if (!t) { stopTimer(); return; }
    var left = remaining(), mm = Math.floor(left / 60), ss = left % 60;
    t.textContent = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
    bar.style.width = (left / QR_SECONDS * 100).toFixed(1) + '%';
    wrap.classList.toggle('low', left > 0 && left <= 60);
    wrap.classList.toggle('over', left === 0);
    if (left === 0 && wasLeft !== 0) { renderQr(); stopTimer(); }
    wasLeft = left;
  }

  /* ── Screenshot: shrink it in the browser so the upload is small and fast ── */
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1400, k = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var q = .85, out = c.toDataURL('image/jpeg', q);
        while (out.length > 1500000 && q > .4) { q -= .1; out = c.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file isn’t a readable image.')); };
      img.src = url;
    });
  }

  function bindForm(m) {
    var form = $('#proof-form'), file = $('#proof-file'), err = $('#proof-file-err'), prev = $('#proof-preview'), al = $('#proof-alert'), picked = null;
    function fileError(msg) { err.textContent = msg; err.hidden = !msg; file.setAttribute('aria-invalid', msg ? 'true' : 'false'); }
    file.addEventListener('change', function () {
      picked = null; prev.hidden = true; fileError('');
      var f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { fileError('Please choose an image (PNG, JPG or WEBP).'); return; }
      if (f.size > 15 * 1024 * 1024) { fileError('That image is too large (max 15 MB).'); return; }
      shrink(f).then(function (data) { picked = data; prev.src = data; prev.hidden = false; }).catch(function (e) { fileError(e.message); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('button[type=submit]', form);
      if (btn.disabled) return;
      al.hidden = true;
      if (!picked) { fileError('Attach your payment screenshot first.'); file.focus(); return; }
      setBusy(btn, true, 'Sending…');
      api('POST', m.submitPath, { screenshot: picked, reference: $('#proof-ref').value.trim() || undefined })
        .then(function () { stopTimer(); return load(); })
        .catch(function (er) {
          setBusy(btn, false);
          if (er.fields && er.fields.screenshot) fileError(er.fields.screenshot);
          else { al.innerHTML = alertBox('error', '', er.message); al.hidden = false; }
          if (er.code === 'ALREADY_SUBMITTED') load();
        });
    });
  }

  /* ── Go ── */
  if (!subjectId) { view.innerHTML = shell('<div style="max-width:640px;margin-top:40px">' + alertBox('error', 'Nothing to pay.', 'Open this page from your dashboard.') + '<a class="btn btn-secondary" style="margin-top:24px" href="dashboard.html">Go to dashboard</a></div>'); return; }
  S.requireUser().then(function () { return S.loadPlans(); }).then(function () { return load(true); }).then(function () {
    // The admin's decision arrives instantly (no refresh needed) — but never redraw while the client is filling the form.
    S.live(function () {
      var form = $('#proof-form');
      if (form && ($('#proof-file').value || $('#proof-ref').value)) return;
      load();
    });
  }).catch(function (err) { if (err && err.message) view.innerHTML = shell(alertBox('error', 'We couldn’t open this page.', err.message)); });
})();
