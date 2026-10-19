# Scaffold Checklist

Weekly scaffold inspections for site. Walk round a scaffold (single detached plot or a pair), tick the checklist preset,
take geo-tagged photos of any snags, then send a PDF report to the scaffold company's contracts manager by email or
WhatsApp. Snags have a 48 hour countdown from when the report is sent.

Works on iPhone, iPad and computer (it's a web app you can add to the home screen).

## Features

- **Checklist preset** - edit, add, remove, reorder and hide items under Admin > Checklist preset.
- **Scaffolds** - single detached plots or pairs (e.g. Plots 101 & 102). Bulk add from the variation sheet. Untick
  "Scaffold up" when it's struck.
- **Geo-tagged snag photos** - taken with the camera, GPS is required, photos older than 5 minutes are rejected, and the
  date/time, GPS coordinates, plot and inspector are burned into the image.
- **Send report** - PDF with photos and Google Maps links. On iPhone/iPad "Share PDF" opens the share sheet so you can
  pick Mail or WhatsApp with the PDF attached. There's also an Email button and a WhatsApp text message button.
- **Export snags to PDF** - on the Snags page, Export PDF builds a clean list of the snags in the current filter (Open,
  Overdue, Closed, All...) grouped by plot, each with its photo, comment, location, status and fix photo if closed.
- **48 hour tracking** - the clock starts when the report is sent; overdue snags show in red. Snags are closed with an
  optional geo-tagged "fixed" photo.
- **Multiple users** - Admin, Inspector, Viewer (read only), Scaffolder (sees and closes snags only). New sign-ups are
  Pending until an admin approves them.
- **Photo-verified snag closing** - snags can only be closed with a live camera photo of the fix. Photos with GPS on
  the plot close automatically; no GPS, off-plot or late uploads go to the site manager to approve (before/after side
  by side).
- **Archive & wipe** - every 2-3 weeks download a ZIP (PDF reports, all photos, snags spreadsheet) then wipe the
  inspection data to stay inside the free Supabase plan. Scaffolds, checklist, users and settings are kept.

## Setup

### 1. Supabase (free plan)

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor > New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
   Then do the same with [`supabase/notifications.sql`](supabase/notifications.sql) (scaffolder role, photo-verified
   snag closing, push subscriptions, 7-day checks).
3. Go to **Authentication > Sign In / Providers > Email** and turn **off** "Confirm email" (recommended - the free plan
   only sends a few emails per hour, so confirmation emails get held up).
4. Go to **Authentication > URL Configuration** and set **Site URL** to your live app address (step 3 below). Add
   `http://localhost:5173` to **Redirect URLs** for local testing.
5. Go to **Project Settings > API** and copy the **Project URL** and the **anon public** key.

### 2. Run it on your computer

```bash
npm install
copy .env.example .env.local   # then paste your Supabase URL and anon key into .env.local
npm run dev
```

Open the address it shows. **The first account you create becomes the admin.**

### 3. Put it online (so everyone on site can use it)

Camera and GPS only work over HTTPS, so host it - [Vercel](https://vercel.com) is free:

1. Push this repo to GitHub.
2. In Vercel, **Add New > Project**, import the repo.
3. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy, then put the Vercel address into Supabase **Site URL** (step 1.4).

### Notifications

The `notify` Edge Function (`supabase/functions/notify`) sends push notifications and emails, and a `pg_cron` job
runs it every 15 minutes to chase snags past 48 hours and scaffolds past their 7-day check.

- Function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`.
- Email (optional): `BREVO_API_KEY` (or `RESEND_API_KEY`), `EMAIL_FROM`, `EMAIL_FROM_NAME`.
- Push only works on the HTTPS (Vercel) address. On iPhone, add the app to the home screen first, then tap
  **Turn on notifications** in the app.
- Scaffold foremen / bosses sign up, then an admin sets their role to **Scaffolder** under Admin > Users.

### 4. Add to iPhone / iPad home screen

Open the site in **Safari > Share > Add to Home Screen**. Allow **Camera** and **Location** when asked. If you
accidentally denied location: Settings > Privacy & Security > Location Services > Safari Websites > While Using.

## First-time admin checklist

1. Admin > **Settings** - site name, contracts manager's name, email, mobile (for WhatsApp), hours to close snags.
2. Admin > **Scaffolds** - bulk paste your plots, one scaffold per line (`101/102` for a pair, `105` for detached).
3. Admin > **Checklist preset** - replace the starter items with your own.
4. Ask everyone on site to create an account, then approve them under Admin > **Users**.

## Free plan notes

- Free plan limits: 500 MB database, 1 GB photo storage. Photos are compressed to roughly 150-300 KB each.
- The app reminds the admin to archive & wipe after 14 days (change under Settings).
- Supabase pauses free projects after 7 days with no activity. Weekly checks normally keep it awake; if it's paused,
  restore it from the Supabase dashboard.
