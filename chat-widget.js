/* STAR PRODUCTION — FAQ chat assistant (floating widget).
   Talks to /api/chat/*. FAQ questions are answered from the FAQ list; anything else is emailed to the team. */
(function () {
  'use strict';
  if (window.__starChat) return;
  window.__starChat = true;

  // Same-origin by default, so it works on any public domain the site is hosted on.
  var API_BASE = (function () {
    if (window.STAR_API_BASE) return window.STAR_API_BASE;
    if (location.protocol === 'file:') return 'http://localhost:4000';
    if (location.port === '5500' || location.port === '5501') return location.protocol + '//' + location.hostname + ':4000';
    return '';
  })();
  // Relative like the site's other images, so it loads wherever index.html loads.
  var BOT_ICON = 'Photos/AI%20Bot/bot-avatar.jpg?v=2'; // the star mascot (face crop of Photos/AI Bot/bot-full.jpg)
  var SUPPORT = 'starprod.in@gmail.com';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Styles (scoped under .sc-) ── */
  var A = 'var(--accent,#33aed6)';
  var css =
    '@property --sc-a{syntax:"<angle>";initial-value:0deg;inherits:false}' +
    '.sc-root,.sc-root *{box-sizing:border-box}' +

    /* Launcher: glass pill with a rotating light ring; label slides out on hover */
    '.sc-launch{position:fixed;right:24px;bottom:24px;z-index:60;display:flex;align-items:center;height:68px;padding:3px;border:0;border-radius:34px;color:var(--mist,#EBEBEB);cursor:pointer;background:rgba(12,9,13,.78);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 18px 50px -10px rgba(0,0,0,.7),0 0 40px -6px rgba(51,174,214,.45);font:700 .74rem/1 var(--sans,system-ui,sans-serif);letter-spacing:.2em;text-transform:uppercase;animation:sc-pop .9s .5s cubic-bezier(.34,1.56,.64,1) both;transition:transform .4s cubic-bezier(.22,1,.36,1),box-shadow .4s}' +
    '.sc-launch::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:2px;background:conic-gradient(from var(--sc-a),transparent 0deg,' + A + ' 70deg,rgba(255,255,255,.85) 100deg,' + A + ' 130deg,transparent 200deg,transparent 360deg);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:sc-spin 5s linear infinite;pointer-events:none}' +
    '.sc-launch::after{content:"";position:absolute;inset:-1px;border-radius:inherit;box-shadow:0 0 0 0 rgba(51,174,214,.55);animation:sc-pulse 3.2s 2s infinite;pointer-events:none}' +
    '.sc-launch:hover{transform:translateY(-3px) scale(1.03);box-shadow:0 22px 60px -10px rgba(0,0,0,.75),0 0 60px -4px rgba(51,174,214,.7)}' +
    '.sc-ico{position:relative;width:62px;height:62px;flex:none;border-radius:50%;object-fit:cover;display:block}' +
    '.sc-launch span{max-width:0;opacity:0;overflow:hidden;white-space:nowrap;transition:max-width .55s cubic-bezier(.22,1,.36,1),opacity .35s,padding .55s cubic-bezier(.22,1,.36,1)}' +
    '.sc-launch:hover span,.sc-launch:focus-visible span{max-width:140px;opacity:1;padding:0 24px 0 10px}' +
    '@keyframes sc-spin{to{--sc-a:360deg}}' +
    '@keyframes sc-pulse{0%{box-shadow:0 0 0 0 rgba(51,174,214,.5)}70%,100%{box-shadow:0 0 0 20px rgba(51,174,214,0)}}' +
    '@keyframes sc-pop{from{opacity:0;transform:translateY(30px) scale(.4)}to{opacity:1;transform:none}}' +

    /* Teaser bubble */
    '.sc-teaser{position:fixed;right:24px;bottom:104px;z-index:60;max-width:250px;padding:14px 40px 14px 16px;border-radius:18px 18px 4px 18px;color:var(--mist,#EBEBEB);background:rgba(18,16,22,.92);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(51,174,214,.35);box-shadow:0 18px 50px -12px rgba(0,0,0,.7);font:500 .86rem/1.45 var(--sans,system-ui,sans-serif);cursor:pointer;animation:sc-teaser .6s cubic-bezier(.34,1.56,.64,1) both}' +
    '.sc-teaser b{display:block;margin-bottom:2px;font-weight:700;letter-spacing:.02em}' +
    '.sc-teaser button{position:absolute;top:8px;right:8px;width:24px;height:24px;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:inherit;cursor:pointer;font-size:14px;line-height:1}' +
    '.sc-teaser button:hover{background:rgba(255,255,255,.18)}' +
    '.sc-teaser[hidden]{display:none}' +
    '@keyframes sc-teaser{from{opacity:0;transform:translateY(16px) scale(.9)}to{opacity:1;transform:none}}' +

    /* Panel */
    '.sc-panel{position:fixed;right:24px;bottom:24px;z-index:61;width:min(410px,calc(100vw - 24px));height:min(660px,calc(100dvh - 48px));display:flex;flex-direction:column;overflow:hidden;border-radius:26px;color:var(--mist,#EBEBEB);font:400 .92rem/1.55 var(--sans,system-ui,sans-serif);background:radial-gradient(120% 60% at 50% -10%,rgba(51,174,214,.22),transparent 60%),linear-gradient(180deg,rgba(18,16,22,.97),rgba(10,8,12,.98));-webkit-backdrop-filter:blur(24px) saturate(140%);backdrop-filter:blur(24px) saturate(140%);box-shadow:0 0 0 1px rgba(255,255,255,.09),0 40px 110px -20px rgba(0,0,0,.85),0 0 90px -30px rgba(51,174,214,.55);transform-origin:calc(100% - 38px) calc(100% - 38px)}' +
    '.sc-panel::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:conic-gradient(from var(--sc-a),transparent 0deg,rgba(51,174,214,.9) 40deg,transparent 110deg,transparent 220deg,rgba(51,174,214,.5) 280deg,transparent 340deg);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:sc-spin 9s linear infinite;pointer-events:none;z-index:3}' +
    '.sc-panel[hidden],.sc-launch[hidden]{display:none}' +
    '.sc-panel.sc-in{animation:sc-open .65s cubic-bezier(.22,1,.36,1) both}' +
    '.sc-panel.sc-out{animation:sc-close .28s cubic-bezier(.5,0,.75,0) both}' +
    '@keyframes sc-open{0%{opacity:0;transform:scale(.3) translateY(40px);filter:blur(10px);border-radius:40px}55%{filter:blur(0)}100%{opacity:1;transform:none;filter:none}}' +
    '@keyframes sc-close{to{opacity:0;transform:scale(.4) translateY(30px);filter:blur(6px)}}' +
    '.sc-panel.sc-in .sc-head,.sc-panel.sc-in .sc-hero>*,.sc-panel.sc-in .sc-form{animation:sc-rise .7s cubic-bezier(.22,1,.36,1) both}' +
    '.sc-panel.sc-in .sc-head{animation-delay:.15s}.sc-panel.sc-in .sc-orb{animation-delay:.25s}.sc-panel.sc-in .sc-hero h3{animation-delay:.35s}.sc-panel.sc-in .sc-hero p{animation-delay:.45s}.sc-panel.sc-in .sc-form{animation-delay:.5s}' +
    '@keyframes sc-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}' +

    '.sc-head{position:relative;z-index:2;display:flex;align-items:center;gap:12px;padding:16px 16px 14px 18px;border-bottom:1px solid rgba(255,255,255,.07)}' +
    '.sc-ava{position:relative;width:44px;height:44px;flex:none;border-radius:50%;object-fit:cover;box-shadow:0 0 0 1.5px rgba(51,174,214,.7),0 0 22px -2px rgba(51,174,214,.6)}' +
    '.sc-title{flex:1;min-width:0}' +
    '.sc-title b{display:block;font:700 .9rem/1.2 var(--display,var(--sans,system-ui));letter-spacing:.2em;text-transform:uppercase}' +
    '.sc-title small{display:flex;align-items:center;gap:7px;margin-top:5px;color:rgba(235,235,235,.62);font-size:.74rem}' +
    '.sc-title small i{width:7px;height:7px;border-radius:50%;background:#3ddc97;box-shadow:0 0 0 0 rgba(61,220,151,.6);animation:sc-live 2.4s infinite}' +
    '@keyframes sc-live{70%,100%{box-shadow:0 0 0 7px rgba(61,220,151,0)}}' +
    '.sc-x{flex:none;width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(255,255,255,.07);color:inherit;cursor:pointer;transition:background .25s,transform .35s cubic-bezier(.22,1,.36,1)}' +
    '.sc-x:hover{background:rgba(255,255,255,.16);transform:rotate(90deg)}.sc-x svg{width:16px;height:16px}' +

    '.sc-log{position:relative;z-index:1;flex:1;overflow-y:auto;padding:8px 16px 16px;display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:rgba(51,174,214,.35) transparent}' +
    '.sc-log::-webkit-scrollbar{width:6px}.sc-log::-webkit-scrollbar-thumb{background:rgba(51,174,214,.35);border-radius:6px}' +

    /* Welcome hero */
    '.sc-hero{display:flex;flex-direction:column;align-items:center;text-align:center;padding:22px 8px 10px}' +
    '.sc-orb{position:relative;width:96px;height:96px;margin-bottom:18px}' +
    '.sc-orb img{position:relative;width:100%;height:100%;border-radius:50%;object-fit:cover;z-index:1}' +
    '.sc-orb::before,.sc-orb::after{content:"";position:absolute;inset:-10px;border-radius:50%;border:1px solid rgba(51,174,214,.5);animation:sc-ring 3.2s ease-out infinite}' +
    '.sc-orb::after{animation-delay:1.6s}' +
    '@keyframes sc-ring{from{transform:scale(.85);opacity:.9}to{transform:scale(1.55);opacity:0}}' +
    '.sc-hero h3{margin:0;font:700 1.45rem/1.2 var(--display,var(--sans,system-ui));letter-spacing:-.01em}' +
    '.sc-hero h3 em{font-style:normal;color:' + A + '}' +
    '.sc-hero p{margin:10px 0 0;max-width:290px;color:rgba(235,235,235,.62);font-size:.86rem}' +

    /* Messages */
    '.sc-row{display:flex;align-items:flex-end;gap:8px;max-width:100%;animation:sc-msg .5s cubic-bezier(.22,1,.36,1) both}' +
    '.sc-row.sc-r-user{justify-content:flex-end}' +
    '.sc-mini{width:28px;height:28px;flex:none;border-radius:50%;object-fit:cover;box-shadow:0 0 0 1px rgba(51,174,214,.55)}' +
    '@keyframes sc-msg{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}' +
    '.sc-msg{max-width:84%;padding:11px 15px;word-wrap:break-word;overflow-wrap:anywhere;white-space:pre-wrap;font-size:.9rem}' +
    '.sc-bot{background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.09);border-radius:6px 18px 18px 18px}' +
    '.sc-user{color:#06161c;font-weight:600;background:linear-gradient(135deg,#5fd0f0,' + A + ' 55%,#1f86ab);border-radius:18px 6px 18px 18px;box-shadow:0 10px 30px -12px rgba(51,174,214,.7)}' +
    '.sc-msg a{color:#8fdcf2;text-decoration:underline;text-underline-offset:3px}' +
    '.sc-msg code{display:block;margin:3px 0;padding:5px 9px;border-radius:8px;background:rgba(0,0,0,.35);font:500 .82rem/1.5 ui-monospace,Consolas,monospace;color:#8fdcf2}' +
    '.sc-msg ul{margin:6px 0 2px;padding-left:20px}' +
    '.sc-cat{display:block;margin-bottom:5px;font-size:.64rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:' + A + '}' +

    '.sc-chips{display:flex;flex-wrap:wrap;gap:8px;padding-left:36px;animation:sc-msg .6s .1s cubic-bezier(.22,1,.36,1) both}' +
    '.sc-chips.sc-first{padding-left:0;justify-content:center}' +
    '.sc-chip{padding:9px 14px;border-radius:99px;background:rgba(255,255,255,.05);color:inherit;border:1px solid rgba(255,255,255,.14);font:inherit;font-size:.8rem;line-height:1.25;text-align:left;cursor:pointer;transition:border-color .25s,background-color .25s,transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s}' +
    '.sc-chip:hover{border-color:rgba(51,174,214,.8);background:rgba(51,174,214,.14);transform:translateY(-2px);box-shadow:0 10px 24px -12px rgba(51,174,214,.8)}' +
    '.sc-chip.sc-ghost{border-style:dashed;color:rgba(235,235,235,.65)}' +
    '.sc-typing{display:flex;align-items:center;gap:5px;padding:15px 16px}' +
    '.sc-typing i{width:6px;height:6px;border-radius:50%;background:' + A + ';animation:sc-dot 1.1s infinite ease-in-out}' +
    '.sc-typing i:nth-child(2){animation-delay:.15s}.sc-typing i:nth-child(3){animation-delay:.3s}' +
    '@keyframes sc-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-4px)}}' +

    '.sc-form{position:relative;z-index:2;display:flex;gap:8px;align-items:center;margin:0 14px 10px;padding:6px 6px 6px 18px;border-radius:99px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);transition:border-color .3s,box-shadow .3s}' +
    '.sc-form:focus-within{border-color:rgba(51,174,214,.85);box-shadow:0 0 0 4px rgba(51,174,214,.14),0 0 30px -8px rgba(51,174,214,.7)}' +
    '.sc-form input{flex:1;min-width:0;padding:9px 0;background:none;color:inherit;border:0;outline:0;font:inherit;font-size:16px}' +
    '.sc-form input::placeholder{color:rgba(235,235,235,.42)}' +
    '.sc-send{flex:none;width:42px;height:42px;display:grid;place-items:center;border:0;border-radius:50%;background:linear-gradient(135deg,#5fd0f0,' + A + ' 60%,#1f86ab);color:#06161c;cursor:pointer;transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s}' +
    '.sc-send:hover:not(:disabled){transform:scale(1.08) rotate(-8deg);box-shadow:0 10px 26px -6px rgba(51,174,214,.9)}' +
    '.sc-send svg{width:18px;height:18px}' +
    '.sc-send:disabled,.sc-form input:disabled{opacity:.5;cursor:not-allowed}' +
    '.sc-foot{position:relative;z-index:2;margin:0;padding:0 16px 14px;color:rgba(235,235,235,.38);font-size:.68rem;letter-spacing:.06em;text-align:center}' +

    '.sc-root button:focus-visible,.sc-root input:focus-visible{outline:2px solid #8fdcf2;outline-offset:2px}' +
    '@media (max-width:520px){.sc-panel{right:0;bottom:0;left:0;width:100vw;height:100vh;height:100dvh;border-radius:0;transform-origin:calc(100% - 44px) calc(100% - 44px)}.sc-panel::before{display:none}.sc-launch{right:12px;bottom:12px;height:56px;border-radius:28px}.sc-ico{width:50px;height:50px}.sc-teaser{right:12px;bottom:80px;max-width:min(250px,calc(100vw - 24px))}.sc-foot{padding-bottom:max(14px,env(safe-area-inset-bottom))}}' +
    '@media (prefers-reduced-motion:reduce){.sc-root *,.sc-root *::before,.sc-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;animation-delay:0s!important;transition-duration:.01ms!important}.sc-log{scroll-behavior:auto}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ── DOM ── */
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  function el(tag, cls) { var n = document.createElement(tag); n.className = cls; return n; }

  var root = el('div', 'sc-root');

  var launch = el('button', 'sc-launch');
  launch.type = 'button';
  launch.setAttribute('aria-haspopup', 'dialog');
  launch.setAttribute('aria-expanded', 'false');
  launch.setAttribute('aria-label', 'Ask STAR PRODUCTION');
  launch.innerHTML = '<img class="sc-ico" src="' + BOT_ICON + '" alt="" /><span>Ask us</span>';

  var teaser = el('div', 'sc-teaser');
  teaser.hidden = true;
  teaser.innerHTML = '<b>Questions about your release?</b>Ask me about plans, payments or how it works.<button type="button" aria-label="Dismiss">×</button>';

  var panel = el('div', 'sc-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'STAR PRODUCTION assistant');
  panel.innerHTML =
    '<div class="sc-head"><img class="sc-ava" src="' + BOT_ICON + '" alt="" />' +
    '<div class="sc-title"><b>STAR PRODUCTION</b><small><i></i>Assistant · replies instantly</small></div>' +
    '<button class="sc-x" type="button" aria-label="Close chat">' + ICON_X + '</button></div>' +
    '<div class="sc-log" role="log" aria-live="polite" aria-label="Conversation"></div>' +
    '<form class="sc-form" autocomplete="off"><input type="text" maxlength="1000" aria-label="Your message" placeholder="Ask anything about your release…" />' +
    '<button class="sc-send" type="submit" aria-label="Send">' + ICON_SEND + '</button></form>' +
    '<p class="sc-foot">Not in our FAQs? We send it straight to the team.</p>';

  var log = panel.querySelector('.sc-log');
  var form = panel.querySelector('form');
  var input = panel.querySelector('input');
  var sendBtn = panel.querySelector('.sc-send');
  var PLACEHOLDER = 'Ask anything about your release…';

  root.appendChild(launch); root.appendChild(teaser); root.appendChild(panel);
  document.body.appendChild(root);

  // If the icon ever fails to load, fall back to a plain mark instead of a broken image.
  Array.prototype.forEach.call(root.querySelectorAll('img'), function (img) {
    img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
  });

  /* ── State ── */
  var started = false, busy = false;
  var awaiting = null;       // { message } while we wait for the visitor's email
  var guestEmail = '';       // remembered for this page visit

  /* ── Rendering helpers ── */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Safe mini-markdown: escape everything first, then allow only mailto:/https: links, `code` and "* " bullets.
  function format(text) {
    var out = [], list = false;
    String(text).split('\n').forEach(function (line) {
      var bullet = /^\* (.*)$/.exec(line);
      var html = esc(bullet ? bullet[1] : line)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\((mailto:[^)\s]+|https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      if (bullet) { out.push((list ? '' : '<ul>') + '<li>' + html + '</li>'); list = true; return; }
      if (list) { out.push('</ul>'); list = false; }
      out.push(html + '\n');
    });
    if (list) out.push('</ul>');
    return out.join('').replace(/\n+$/, '').replace(/\n{3,}/g, '\n\n');
  }

  function scroll() { log.scrollTop = log.scrollHeight; }

  function botRow(bubble) {
    var row = el('div', 'sc-row');
    var av = el('img', 'sc-mini'); av.src = BOT_ICON; av.alt = '';
    av.addEventListener('error', function () { av.style.visibility = 'hidden'; });
    row.appendChild(av); row.appendChild(bubble);
    log.appendChild(row); scroll();
    return row;
  }
  function addBot(text, category) {
    var m = el('div', 'sc-msg sc-bot');
    m.innerHTML = (category ? '<span class="sc-cat">' + esc(category) + '</span>' : '') + format(text);
    botRow(m);
  }
  function addUser(text) {
    var row = el('div', 'sc-row sc-r-user');
    var m = el('div', 'sc-msg sc-user');
    m.textContent = text;
    row.appendChild(m);
    log.appendChild(row); scroll();
  }
  function addChips(items, first) {
    if (!items.length) return;
    var wrap = el('div', 'sc-chips' + (first ? ' sc-first' : ''));
    items.forEach(function (it) {
      var b = el('button', 'sc-chip' + (it.ghost ? ' sc-ghost' : ''));
      b.type = 'button';
      b.textContent = it.label;
      b.addEventListener('click', function () { wrap.remove(); it.run(); });
      wrap.appendChild(b);
    });
    log.appendChild(wrap); scroll();
  }
  function typing(on) {
    var t = log.querySelector('.sc-typing-row');
    if (!on) { if (t) t.remove(); return; }
    if (t) return;
    var b = el('div', 'sc-msg sc-bot sc-typing');
    b.setAttribute('aria-label', 'Assistant is typing');
    b.innerHTML = '<i></i><i></i><i></i>';
    botRow(b).className += ' sc-typing-row';
  }
  function setBusy(v) {
    busy = v; input.disabled = v; sendBtn.disabled = v;
    if (!v && !panel.hidden) input.focus();
  }
  function resetInput() {
    input.type = 'text'; input.placeholder = PLACEHOLDER; input.setAttribute('aria-label', 'Your message');
  }

  /* ── API ── */
  function post(path, body) {
    return fetch(API_BASE + '/api/chat' + path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.ok) return data;
        var e = (data && data.error) || {};
        var err = new Error(e.message || '');
        err.code = e.code; err.fields = e.fields || {}; err.status = res.status;
        throw err;
      });
    });
  }
  // A ready-to-send email draft, so a question is never lost when the chat can't deliver it.
  function mailtoLink(message) {
    var url = 'mailto:' + SUPPORT + '?subject=' + encodeURIComponent('Question from the STAR PRODUCTION website') +
      '&body=' + encodeURIComponent(message || '');
    return '[Email us directly](' + url.replace(/\)/g, '%29') + ')';
  }
  // Visitors only ever see friendly wording — never technical details.
  function fail(err, message) {
    if (err && err.code === 'RATE_LIMITED' && err.message) { addBot(err.message); return; }
    var lead = message
      ? 'Sorry, I couldn\'t send that just now — but your question isn\'t lost. '
      : 'Sorry, I\'m having trouble connecting right now. Please try again in a moment. ';
    addBot(lead + mailtoLink(message) + ' at ' + SUPPORT + '.');
  }

  /* ── Conversation ── */
  function askEmail(message) {
    awaiting = { message: message };
    input.type = 'email';
    input.placeholder = 'Your email address';
    input.setAttribute('aria-label', 'Your email address');
    addBot('I\'ll pass this to our team. What email address should they reply to?');
    addChips([{ label: 'Cancel', ghost: true, run: cancelAwait }]);
    input.focus();
  }
  function cancelAwait() {
    awaiting = null; resetInput();
    addBot('No problem. Ask me anything else, or email us anytime at [' + SUPPORT + '](mailto:' + SUPPORT + ').');
  }
  function sent() {
    addBot('Done! I\'ve sent your question to our team. They\'ll reply by email — we aim to respond within 3 working days.');
    addChips(suggestionChips());
  }

  function handoff(message, email) {
    setBusy(true); typing(true);
    var body = { message: message };
    if (email) body.email = email;
    return post('/handoff', body).then(function () {
      typing(false);
      if (awaiting) { awaiting = null; resetInput(); }
      sent();
    }).catch(function (err) {
      typing(false);
      if (err.fields && err.fields.email && !email) return askEmail(message);        // guest: need an address first
      if (err.fields && err.fields.email) { addBot('That email doesn\'t look right. Please check it and try again.'); return; }
      if (awaiting) { awaiting = null; resetInput(); }
      fail(err, message);
    }).then(function () { setBusy(false); });
  }

  // The FAQ list and matcher are plain files in data/chat/, loaded by the browser — so FAQ answers
  // work instantly wherever the page is loaded. Only unanswered questions need the server.
  // A plain <script> (not a module), so it also loads when index.html is opened straight from a folder.
  var matcher;
  function getMatcher() {
    if (!matcher) matcher = new Promise(function (resolve) {
      if (window.STAR_FAQ) return resolve(window.STAR_FAQ);
      var s = document.createElement('script');
      s.src = 'data/chat/faq.js';
      s.onload = function () { resolve(window.STAR_FAQ || null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return matcher;
  }
  function localAnswer(text) {
    return getMatcher().then(function (m) {
      if (!m) return post('/message', { message: text });     // module unavailable → ask the server instead
      var r = m.answerMessage(text);
      if (r.type === 'faq') return { type: 'faq', answer: r.faq.answer, category: r.faq.category, related: r.related };
      return r;
    });
  }

  function ask(text) {
    addUser(text);
    setBusy(true); typing(true);
    localAnswer(text).then(function (r) {
      typing(false);
      switch (r.type) {
        case 'unknown':            // not in the FAQs → the admin panel (the server asks guests for an email first)
          return handoff(text, guestEmail || undefined);
        case 'faq':
          addBot(r.answer, r.category);
          var chips = (r.related || []).map(function (q) { return { label: q.question, run: function () { ask(q.question); } }; });
          chips.push({ label: 'Not what I meant — ask the team', ghost: true, run: function () { handoff(text, guestEmail || undefined); } });
          addChips(chips);
          break;
        case 'greeting': case 'thanks':
          addBot(r.answer);
          if (r.type === 'greeting') addChips(suggestionChips());
          break;
        case 'clarify':
          addBot('Could you tell me a little more? Ask a full question about our plans, payments or process, and I\'ll help.');
          break;
        case 'need_email':
          if (guestEmail) return handoff(text, guestEmail);
          askEmail(text);
          break;
        case 'sent': sent(); break;
        default:
          fail(null, text);
      }
    }).catch(function (err) { typing(false); fail(err, text); }).then(function () { setBusy(false); });
  }

  var popular = [];
  function suggestionChips() {
    return popular.map(function (q) { return { label: q.question, run: function () { ask(q.question); } }; });
  }

  function start() {
    started = true;
    var hero = el('div', 'sc-hero');
    hero.innerHTML = '<div class="sc-orb"><img src="' + BOT_ICON + '" alt="" /></div>' +
      '<h3>How can we help<br>your <em>release?</em></h3>' +
      '<p>Ask about plans, payments or the project process — or pick a question below.</p>';
    var heroImg = hero.querySelector('img');
    heroImg.addEventListener('error', function () { heroImg.style.visibility = 'hidden'; });
    log.appendChild(hero);
    getMatcher().then(function (f) {
      if (!f) throw new Error('no faq');
      return f.POPULAR_FAQ_IDS.map(function (id) {
        var q = f.FAQS.filter(function (x) { return x.id === id; })[0];
        return { id: id, question: q.q };
      });
    }).catch(function () {
      return fetch(API_BASE + '/api/chat/faqs', { credentials: 'include' })
        .then(function (r) { return r.ok ? r.json() : { popular: [] }; })
        .then(function (d) { return d.popular || []; });
    }).catch(function () { return []; })
      .then(function (list) { popular = list; addChips(suggestionChips(), true); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var value = input.value.trim();
    if (!value) return;
    input.value = '';
    Array.prototype.forEach.call(log.querySelectorAll('.sc-chips'), function (c) { c.remove(); });

    if (awaiting) {
      if (!EMAIL_RE.test(value)) { addBot('That doesn\'t look like a valid email. Please enter it like name@example.com.'); return; }
      addUser(value);
      guestEmail = value;
      handoff(awaiting.message, value);
      return;
    }
    ask(value);
  });

  /* ── Open / close ── */
  var teaserTimer, hideTimer;
  function hideTeaser() { clearTimeout(teaserTimer); teaser.hidden = true; try { sessionStorage.setItem('sc-teased', '1'); } catch (e) {} }
  function open() {
    clearTimeout(hideTimer);
    hideTeaser();
    panel.hidden = false; panel.classList.remove('sc-out'); panel.classList.add('sc-in');
    launch.hidden = true;
    launch.setAttribute('aria-expanded', 'true');
    if (!started) start();
    setTimeout(function () { input.focus(); }, reduceMotion ? 0 : 450);
  }
  function close() {
    panel.classList.remove('sc-in'); panel.classList.add('sc-out');
    launch.setAttribute('aria-expanded', 'false');
    hideTimer = setTimeout(function () {
      panel.hidden = true; panel.classList.remove('sc-out');
      launch.hidden = false; launch.focus();
    }, reduceMotion ? 0 : 280);
  }
  window.StarChat = { open: open, close: close }; // lets the dashboard open the assistant
  launch.addEventListener('click', open);
  teaser.addEventListener('click', open);
  teaser.querySelector('button').addEventListener('click', function (e) { e.stopPropagation(); hideTeaser(); });
  panel.querySelector('.sc-x').addEventListener('click', close);
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  // The admin control room needs the full screen, so the assistant steps aside there.
  function syncAdmin() { root.style.display = /^#\/admin/.test(location.hash) ? 'none' : ''; }
  window.addEventListener('hashchange', syncAdmin);
  setInterval(syncAdmin, 700); // the site also changes pages with history.replaceState, which fires no event
  syncAdmin();

  // A gentle nudge once per visit, a few seconds after the page settles.
  try { if (!sessionStorage.getItem('sc-teased')) {
    teaserTimer = setTimeout(function () {
      if (!panel.hidden) return;
      teaser.hidden = false;
      setTimeout(function () { if (!teaser.hidden) hideTeaser(); }, 14000);
    }, 5000);
  } } catch (e) {}
})();
