# LaptopCare — Warranty & Service Portal

Live customer portal + staff admin for LaptopCare (3F1, 3rd Floor, Unity Plaza, Colombo 04).
Two pages, one Supabase project, zero build step — pure static files that run on
**GitHub Pages** (or any static host).

| Page | URL | What it does |
|------|-----|--------------|
| Customer portal | `index.html` | Look up **warranty status** or **service status** by serial number, and **book a service**. |
| Staff admin | `admin.html` | Staff sign-in, live stat cards, searchable/editable tables for warranty & service records, CSV export. |

> The admin page is intentionally **not linked** from the customer portal and is
> marked `noindex`. It still lives at a normal URL — anyone who finds it still
> needs a valid staff sign-in (Supabase Auth), and your database should be
> protected with the RLS policies in [`db/schema.sql`](db/schema.sql).

---

## Project structure

```
index.html               Customer portal (enhanced)
admin.html               Staff admin dashboard (enhanced)
assets/
  config.js              ★ URL/key/table/stage config — edit once here
  customer.css           Customer portal styles
  customer.js            Customer portal logic
  admin.css              Admin styles
  admin.js               Admin logic (auth, stats, CRUD, filter, export)
  laptopcare-logo.png    Logo (extracted from the old inline base64)
db/
  schema.sql             Reference schema + recommended security policies
```

### What was enhanced (v2)

**Customer portal**
- Segmented, mobile-friendly tab layout with clear status explanations
- Result cards with color-coded status banners + notes callouts
- Visual **progress timeline** for warranty (6 stages) and service (4 stages),
  including an *On Hold* indicator
- **Recent lookups** remembered on the device (chips to re-check; no data sent anywhere)
- Smarter errors, “last updated today / N days ago”, quick links (call / email with
  the serial prefilled)
- Booking form with per-field validation, **duplicate-open-booking warning** and a
  clear confirmation screen, plus a “check my status now” shortcut
- Deep links: `index.html?tab=service&sn=SN1234` auto-checks a serial;
  `?tab=book&sn=SN1234` prefills the booking form
- FAQ + contact cards on the page; logo now served as a real asset instead of a
  47 KB base64 blob (faster loads)

**Staff admin**
- Sign-in restored from session; Show/Hide password
- **8 live stat cards** (open repairs, ready for pickup, new bookings, active
  services, on hold, completed…) — clicking one jumps to the filtered table
- Search (serial / customer / phone / model / invoice), status filter,
  pagination, and **CSV export** of the filtered view
- Inline editing with per-row Save; **delete with confirmation**; status color on
  every row
- Smarter **add-record forms** with duplicate-serial detection
  (warranty duplicates are blocked, service duplicates warn first)
- Auto behaviour: completing a service fills the end date; every save/add stamps
  `last_updated`
- Toasts, auto-refresh (paused while you type in a cell), “updated HH:MM:SS” stamp
- All data is escaped on render (XSS-safe) and error messages are friendly

---

## Run it locally

Any static file server works — no build step, no npm install:

```bash
# from the project folder
python3 -m http.server 8000
# open http://localhost:8000
```

Admin demo credentials are whatever users you create in Supabase Auth
(see *Setup on a new Supabase project* below).

---

## Deploy to GitHub Pages

This repo **already has GitHub Pages enabled**
(`Settings → Pages`, source: *Deploy from a branch*, `main`, `/`).

1. Merge your changes into `main` (or push to it directly).
2. GitHub rebuilds Pages automatically — the site is live a minute later at:
   `https://<your-org>.github.io/warranty-portal/`
3. `index.html` is the default page at the root. The admin is at `/admin.html`.

`.nojekyll` is included so GitHub Pages serves the files exactly as-is.

---

## Setup on a (new) Supabase project

Everything points at one place: **`assets/config.js`**.

1. Create a Supabase project, then in **SQL Editor** run the scripts in
   [`db/schema.sql`](db/schema.sql) (tables first, then policies).
2. Create staff accounts: **Authentication → Users → Invite user**
   (these are the people who sign in on `admin.html`).
3. Copy your **Project URL** and **anon publishable key**
   (Settings → API) into `assets/config.js`.
4. Re-deploy / push. Done.

The app only ever uses the publishable anon key (safe to embed in a public site
when RLS is on) — the admin page signs the same client in with staff credentials.

### Data model used by the code (keep these column names)

`warranty_status`: `id`, `serial_number`, `customer_name`, `status`,
`handover_date`, `estimated_completion`, `notes`, `last_updated`

`service_status`: `id`, `serial_number`, `customer_name`, `phone_number`,
`laptop_model`, `purchase_date`, `invoice_number`, `status`, `scheduled_date`,
`service_end_date`, `notes`, `last_updated`

Stages: warranty `Received → Diagnosis → Parts Ordered → In Repair → Ready for
Pickup → Completed` · service `Processing → Scheduled → Service in Progress →
Complete` · plus `On Hold` on both. Stage lists live in `assets/config.js`.

---

## Notes & support

- Status updates appear to customers instantly (live reads from the same tables).
- Contact: +94 775 741 069 · laptopcareunity@gmail.com · www.laptopcare.lk
