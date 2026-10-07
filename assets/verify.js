/* STAR PRODUCTION — verify.html: the page behind the link in the verification email.
   Flow: Backend validates the token → valid: email verified, token used up, "success" → log in
                                      → invalid / expired: error + the option to resend the verification email. */
(function () {
  'use strict';
  var S = window.STAR, $ = S.$, esc = S.esc, api = S.api, shell = S.shell, setBusy = S.setBusy;
  var view = $('#view'), token = new URLSearchParams(location.search).get('token');
  S.renderHeader(null);

  function card(tone, icon, title, bodyHtml, actions) {
    view.innerHTML = shell('<div class="status-wrap-inline"><div class="status-card ' + tone + '" style="margin:0 auto;margin-top:calc(var(--nav-h) - 20px)">' +
      '<div class="status-icon">' + S.icon(icon, '', 1.6) + '</div><h1>' + esc(title) + '</h1><div class="msg">' + bodyHtml + '</div>' +
      '<div class="actions" style="margin-top:28px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">' + actions + '</div></div></div>');
  }

  /* Invalid / expired / missing link → say so, and let them ask for a new email right here. */
  function failed(message) {
    card('', 'alert', 'We couldn’t verify this link', '<p>' + message + '</p>' +
      '<form id="resend-form" novalidate style="margin-top:22px;text-align:left"><div class="field"><label for="resend-email">Your email address</label>' +
      '<input class="input" id="resend-email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required /></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Resend verification email</button></form><div id="resend-out" style="margin-top:16px" hidden></div>', '');
    $('#resend-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#resend-email').value.trim(), btn = $('button[type=submit]', e.target), out = $('#resend-out');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { out.innerHTML = S.alertBox('error', '', 'Enter a valid email address.'); out.hidden = false; return; }
      setBusy(btn, true, 'Sending…');
      api('POST', '/auth/resend-verification-public', { email: email }).then(function (res) {
        setBusy(btn, false); out.innerHTML = S.alertBox('success', 'Email on its way', res.message); out.hidden = false;
      }).catch(function (err) { setBusy(btn, false); out.innerHTML = S.alertBox('error', '', err.message); out.hidden = false; });
    });
  }

  if (!token) { failed('Open the link from the email we sent you — or enter your address below and we’ll send a new one.'); return; }
  api('POST', '/auth/verify-email', { token: token }).then(function (res) {
    card('ok', 'check', 'Email verified', '<p>Thank you! <b>' + esc(res.email) + '</b> is confirmed. You can now log in, pay for your plan, and your invoice will be sent to this address.</p>',
      '<a class="btn btn-primary" href="index.html#/login?next=%2Fdashboard">Log in to your dashboard ' + S.ARROW + '</a>');
  }).catch(function (err) { failed(err.message || 'This verification link is invalid or has expired.'); });
})();