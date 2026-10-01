# Willrot

A personal habit and goal consistency tracker, built as a single-file PWA (vanilla JS, no build step) on Supabase.

**Live:** https://gioelestrazzarino.github.io/willrot/

## Layout

```
docs/                      ← GitHub Pages root (main branch, /docs)
  index.html               ← the entire app
  sw.js                    ← service worker (offline shell + Web Push)
  manifest.json, icons/
supabase/
  migrations/…_init.sql    ← tables + RLS
  functions/send-reminders ← Edge Function: works out what's due and sends Web Push
  cron.sql                 ← pg_cron job that calls the function hourly
tools/make_icons.py        ← regenerates docs/icons (pure Python, no deps)
```

## Releasing a change

Bump `APP_VERSION` in `docs/index.html` **and** `VERSION` in `docs/sw.js`, then push.
On load, the app compares `APP_VERSION` against localStorage. If they differ, it clears the caches and reloads.

## One-time Supabase setup

1. **Schema:** paste `supabase/migrations/20261001000000_init.sql` into Dashboard → SQL Editor → Run.
2. **Auth URLs:** go to Dashboard → Authentication → URL Configuration. Set the Site URL to `https://gioelestrazzarino.github.io/willrot/` and add the same URL under Redirect URLs. Confirmation and password-reset links need this.
3. **Edge Function:** create a function named `send-reminders` from `supabase/functions/send-reminders/index.ts` (Dashboard → Edge Functions → Deploy new function → via editor, or `supabase functions deploy send-reminders --no-verify-jwt`). **Turn "Verify JWT" off** for it, because the function checks auth itself.
4. **Function secrets** (Edge Functions → Secrets): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`. These are generated locally and never committed.
5. **Cron:** run `supabase/cron.sql` in the SQL Editor, with `<CRON_SECRET>` replaced by the value from step 4.

## Scheduling rules

- `daily`: due every day from the start date.
- `every_n_days`: due every Nth day, counted from the start date.
- `specific_weekdays`: `cadence_config.days` uses 0 = Sunday … 6 = Saturday.
- `n_per_week`: has no due days. It shows an "X/N this week" counter (weeks start Monday) and is left out of the perfect-day streak.
- **Per-habit streak:** consecutive scheduled periods completed, counting back from the newest. An unfinished today never breaks it.
- **Perfect-day streak:** consecutive finished days on which every day-based habit due that day was done. Days with nothing due are neutral.
