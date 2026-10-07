# STAR PRODUCTION

Music-production studio website with client accounts, a project dashboard, UPI-QR payments verified by the admin, messaging with the team, an FAQ chat assistant and an admin control room.

## Three ways to run it

| How | What you do | Data |
|---|---|---|
| **Standalone** (any computer, nothing to install) | Double-click `index.html` | Saved in that browser only. Every feature works, for one person/computer. |
| **Your computer with the server** | Double-click `START.bat`, open http://localhost:4000 | A real database file on that computer. Opening `index.html` while it runs moves to it automatically. |
| **Public website** | Host the server — see `DEPLOY.md` | One shared database for all visitors. |

The pages detect the server by themselves: if it answers, they use it; if not, they switch to standalone mode (a small "Standalone mode" notice shows for a few seconds). Don't put the files on a plain static host and call it done — every visitor would get their *own* private data. For a shared public site, run the server.

**Admin logins** (two official staff accounts, set in `.env` / the host settings — see `DEPLOY.md`):
- **Main admin** — every client detail (clients, projects, messages, plans, email log); can **not** confirm payments.
- **Payments admin** — payment details and **confirms / rejects payments**; also messages and the overview numbers (projects, clients, revenue). Projects are read-only for this role.
- Both can message clients and see total revenue, clients and projects. Any other staff account is removed on every start.

## Pages

| Page | File | What it is |
|---|---|---|
| Website | `index.html` | Home, plans, login, sign up, checkout |
| Client dashboard | `dashboard.html` | Current plan, project progress, **Pay now**, upgrade, past plans, messages with the team |
| Payment | `pay.html` | The UPI QR with a **5-minute timer**, and "send payment confirmation" (screenshot) to the admin |
| Admin panel | `admin.html` | Projects, clients (set new password), per-client messages & replies, **payment verification requests**, plans |
| Assistant | `chat-widget.js` | Answers the FAQs in `data/chat/faq.js`; anything else goes to the admin's Messages tab |

Shared code: `assets/site.css`, `assets/portal.css`, `assets/common.js`, `assets/standalone.js` (+ `standalone-boot.js`), `data/plans.js` (plans & prices), `data/chat/faq.js` (FAQ answers).

## How a payment works

```
Client applies for a plan            → stage 1 Applied
Admin verifies details, sets stage   → 4 Payment Pending   (client's dashboard shows "Pay now")
Client opens pay.html                → scans the QR (valid 5 minutes, "Show QR again" afterwards)
Client pays, attaches a screenshot   → "We'll verify your payment under 24 hrs"
                                       (+ optional transaction / UTR id)
Admin sees a notification            → banner, "Payments · 1 to verify" badge, browser-tab count, toast
Admin checks the money, Confirm      → order PAID, stage 5 Invoice Issued — the client's pages update instantly
   or Reject with a reason           → the client sees the reason and can pay again
```

### Emails

Sent through the Gmail SMTP settings in `.env` (see `DEPLOY.md`); a failed email never blocks a signup or payment.

| When | Who gets it | What |
|---|---|---|
| Sign up | the client, at the address they signed up with | **Verify your email** link (valid 48 hours). The client **cannot log in until they click it**; an expired link offers *Resend verification email* (also on the login screen and the verify page). The main admin can *Mark verified* by hand if mail never arrives |
| Client sends payment screenshot | admin | *Payment to verify* |
| Payments admin **rejects** a payment | the client | *Your payment wasn't accepted* — the reason, no invoice, a *Pay again* button |
| Payments admin **confirms a payment or upgrade** | the client | **Invoice** (INV-date-id) — in the email and as an attachable `.html` file to open or print — plus a *new paid order* notice to the admin |
| Admin replies to a message / client changes password | the client (+ admin for password changes) | reply / security notice |

In standalone mode (no server), or while no email provider is configured, no emails can be sent, so new accounts are verified at sign-up and log straight in. Switch the gate off on purpose with REQUIRE_EMAIL_VERIFICATION=false.


### Discount codes and referrals

- **NEW-STAR**: 15% off a client's **first** order only (checked on the server; a cancelled order doesn't count).
- **Referral code**: every client has their own code (`STAR-XXXXXX`, on the dashboard under *Refer a friend*). A friend who enters it on their plan gets **10% off** (once, never their own code). When that friend's payment is **confirmed**, the code's owner earns a **10% reward**, applied automatically to their next plan (an email tells them).
- One discount per order (they don't stack); the discount carries over when the plan is changed or upgraded, and the invoice shows it. The admin sees it on each order. Prices are always worked out on the server.

### Upgrading a plan

- **Not paid yet:** the plan and price switch immediately.
- **Already paid (before production starts):** the client picks a higher plan and gets a **second payment of the difference** — the same QR page, 5-minute timer and screenshot confirmation (`pay.html?upgrade_id=…`). It shows up for the admin like any payment request (tagged *Upgrade: A → B*); on **Confirm** the plan switches. Rejected → the client sees the reason and can pay again; an unpaid upgrade can be cancelled.

### Changing a password

On the dashboard, **Change password** asks for the current password (plus the new one twice). When it's right the password changes, other devices are signed out, the client gets a security email, and the admin is informed — a 🔐 *Account notice* appears in the admin's Messages (counted as unread) and an email goes to `ADMIN_NOTIFY_EMAIL`. A forgotten password still uses *Forgot password* on the login page, or the admin's **Set new password**.

The QR image is `Photos/Payment/UPI-QR.jpg` — replace the file to change it. Clients can only send the screenshot once the admin has set "Payment Pending", and nothing a client sends can mark an order as paid — only the admin's *Confirm* does.

## Project layout

```
index.html dashboard.html pay.html admin.html   the pages
assets/      CSS + JavaScript for the pages (incl. the standalone engine)
data/        plans.js (prices) and chat/faq.js (assistant FAQs)
Photos/      logo, project covers, bot icon, payment QR
server/      Node.js + Express + Prisma (SQLite): API, sessions, database, email, real-time updates
START.bat    one-click start on Windows
Dockerfile, render.yaml, DEPLOY.md   publishing
```

Passwords are stored as one-way hashes; the admin can set a new password for a client but can never read one. The server pushes tiny "something changed" signals (Server-Sent Events) so dashboards and the admin panel update without refreshing; standalone mode does the same across browser tabs.

## Tests

`npm test` runs the server API tests and the standalone-engine tests (which check the browser version behaves like the server).
