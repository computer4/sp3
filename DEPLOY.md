# Putting STAR PRODUCTION online

One service runs everything: the website, the client dashboard (`/dashboard`), the admin panel (`/admin`), the chat assistant and the API. It needs **Node.js hosting with a persistent disk** (the database is a file) — a static host (GitHub Pages, Netlify, Google Drive) cannot run it.

## Option A — Render (easiest)

1. Put this folder in a **private GitHub repository** (the `.gitignore` already keeps `.env` and databases out).
2. On render.com → **New → Blueprint** → choose the repository. Render reads `render.yaml`.
3. Fill in the values it asks for:

   | Setting | Value |
   |---|---|
   | `APP_URL` | your public address, e.g. `https://starproduction.in` (use the `https://….onrender.com` address first if you like) |
   | `ADMIN_EMAIL` | the email you will log in to the admin panel with |
   | `ADMIN_PASSWORD` | a **long** password (12+ characters) — the server refuses to start with a shorter one |
   | `EMAIL_API_KEY` | the Gmail App Password for starprod.in@gmail.com |

4. Deploy. Open `https://your-address/` — the site is live. Admin: `https://your-address/admin`.
5. Custom domain: Render → Settings → Custom Domains, then set `APP_URL` to it.

The start command applies database updates automatically, makes sure the 4 plans and the two staff accounts exist, then starts the server. Updating the site later = push to GitHub; Render redeploys, and the data on the disk is kept.

## Option B — any Docker host (Railway, Fly.io, DigitalOcean, a VPS)

```bash
docker build -t star-production .
docker run -d --name star -p 4000:4000 -v star-data:/data --restart unless-stopped \
  -e APP_URL=https://your-domain -e SESSION_SECRET=<48+ random characters> \
  -e MAIN_ADMIN_EMAIL=main@example.com -e MAIN_ADMIN_PASSWORD=<10+ characters> \
  -e SIDE_ADMIN_EMAIL=payments@example.com -e SIDE_ADMIN_PASSWORD=<10+ characters> \
  -e SMTP_HOST=smtp.gmail.com -e SMTP_USER=starprod.in@gmail.com -e EMAIL_API_KEY=<app password> \
  star-production
```

Put HTTPS in front (Caddy, nginx or the host's own TLS) and forward to port 4000. Keep `-v star-data:/data` — that volume **is** the database.
Random secret: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

## What to know before announcing it

- **Staff logins.** Two accounts are created from the settings above on every start, and any other staff account is removed: the **main admin** (every client detail, projects, messages; cannot confirm payments) and the **payments admin** (payments and confirming them, messages, the overview numbers). The server refuses staff passwords shorter than 10 characters in production — use long, unique ones. Staff accounts are never reset by email: each admin changes their own password in the admin panel (**Change my password**, which asks for the current one). The password in the settings is only used when the account is first created; if one is ever forgotten, set RESET_STAFF_PASSWORDS=true for a single deploy (the settings' password is applied again), then remove it.
- **Payments.** Clients pay your UPI QR (Photos/Payment/UPI-QR.jpg — replace the file to change it) and send a screenshot; you confirm each one in the admin panel. No payment-gateway account or keys are needed. Check the money in your bank/UPI app before pressing *Confirm*.
- **Email (verification links, invoices, replies).** Two ways out — pick whichever your host allows:
  1. **Gmail SMTP** (works on a VPS and on paid Render plans): `SMTP_HOST=smtp.gmail.com`, `SMTP_USER`, and `EMAIL_API_KEY` = a Google *App Password*.
  2. **Brevo HTTPS API** (works on every host, including free tiers that block SMTP ports): create a free account at brevo.com → *Senders* → add and verify the address in `EMAIL_FROM` (e.g. starprod.in@gmail.com) → *SMTP & API* → create an API key → set `BREVO_API_KEY`. When it is set, it is used instead of SMTP.
  Open **Admin → Emails** (main admin) to see whether mail is working: it shows the connection status, every email the server tried to send with its result or error, and a *Send test email* button. If clients say nothing arrives, look there first — and make sure `APP_URL` is your public address, because the link in the email is built from it. (The offline *standalone* version of the site can't send email at all.)
- **Backups.** Everything is in one file, `/data/star.db`. Back it up regularly (Render: disk snapshots; Docker: copy the volume).
- **Scaling.** One server with SQLite is plenty for a growing studio. For several servers, switch Prisma to PostgreSQL (see the note at the top of `server/prisma/schema.prisma`).
- **Health check.** `GET /api/health` returns `{ "ok": true }`.

## Running on your own computer

- **With the server:** double-click `START.bat`, then open http://localhost:4000.
- **Without anything installed:** double-click `index.html`. The pages run in *standalone mode* (data saved in that browser only). Don't use this for the public site — each visitor would get their own private copy; publish the server instead.
