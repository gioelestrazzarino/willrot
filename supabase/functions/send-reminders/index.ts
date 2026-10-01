// Willrot — send-reminders Edge Function
//
// Two entry points:
//   1. pg_cron (hourly) → POST with header `x-cron-secret: <CRON_SECRET>`.
//      For every push subscription whose local hour == remind_hour and that
//      hasn't been processed today, compute what's still due and push it.
//   2. The app's "Send test notification" button → POST {test:true} with the
//      user's JWT in Authorization. Sends a test push to that user only.
//
// Required secrets (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// Deploy with JWT verification OFF (the function checks auth itself):
//   supabase functions deploy send-reminders --no-verify-jwt

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "https://gioelestrazzarino.github.io/willrot/",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

// ---------- date + cadence helpers (mirror of the client logic) ----------
const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");
const dnum = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};
const dstr = (n: number) => {
  const d = new Date(n * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const wd = (n: number) => (((n % 7) + 7 + 4) % 7); // 0 = Sunday
const weekStart = (n: number) => n - ((wd(n) + 6) % 7); // Monday-based weeks

function localParts(tz: string, at = new Date()) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  }
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

type Habit = {
  id: string; name: string; type: "boolean" | "quantity"; target_value: number | null;
  cadence_type: string; cadence_config: Record<string, unknown>; created_at: string;
};
type Log = { habit_id: string; date: string; completed: boolean; value: number | null };

const isDone = (h: Habit, l?: Log) => {
  if (!l) return false;
  if (h.type === "quantity") {
    const t = Number(h.target_value) || 0;
    return t > 0 ? (Number(l.value) || 0) >= t : (Number(l.value) || 0) > 0;
  }
  return !!l.completed;
};

function isDueDay(h: Habit, n: number, start: number) {
  if (n < start) return false;
  const c = h.cadence_config || {};
  switch (h.cadence_type) {
    case "daily": return true;
    case "every_n_days": return (n - start) % Math.max(1, Number(c.n) || 1) === 0;
    case "specific_weekdays": return Array.isArray(c.days) && (c.days as number[]).map(Number).includes(wd(n));
    default: return false;
  }
}

/** Habits that still need doing today, in the user's timezone. */
function pendingToday(habits: Habit[], logs: Log[], tz: string, today: string) {
  const t = dnum(today);
  const byKey = new Map(logs.map((l) => [`${l.habit_id}|${l.date}`, l]));
  const out: string[] = [];
  for (const h of habits) {
    const start = dnum(localParts(tz, new Date(h.created_at)).date);
    if (h.cadence_type === "n_per_week") {
      // Only nag when the remaining days this week are just enough to hit N.
      const need = Math.max(1, Number(h.cadence_config?.n) || 1);
      const ws = weekStart(t);
      let done = 0;
      for (let n = ws; n <= t; n++) if (isDone(h, byKey.get(`${h.id}|${dstr(n)}`))) done++;
      const remaining = need - done;
      const daysLeft = ws + 6 - t + 1;
      const doneToday = isDone(h, byKey.get(`${h.id}|${today}`));
      if (remaining > 0 && remaining >= daysLeft && !doneToday && t >= start) out.push(h.name);
    } else if (isDueDay(h, t, start) && !isDone(h, byKey.get(`${h.id}|${today}`))) {
      out.push(h.name);
    }
  }
  return out;
}

async function send(sub: { id: string; endpoint: string; p256dh: string; auth: string }, payload: unknown) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 6, urgency: "normal" },
    );
    return "sent";
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) {
      await admin.from("push_subscriptions").delete().eq("id", sub.id);
      return "expired";
    }
    console.error("push failed", code, (e as Error).message);
    return "error";
  }
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const body = await req.json().catch(() => ({}));

  // (2) test push for the signed-in user
  if (body?.test) {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u?.user) return json({ error: "unauthorized" }, 401);
    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", u.user.id);
    if (!subs?.length) return json({ error: "no subscription for this user" }, 404);
    const results = await Promise.all(subs.map((s) =>
      send(s, { title: "Willrot", body: "Notifications are working. Keep the ember lit.", tag: "willrot-test", url: "./#/today" })));
    return json({ ok: true, results });
  }

  // (1) scheduled run
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const { data: subs, error } = await admin.from("push_subscriptions").select("*");
  if (error) return json({ error: error.message }, 500);

  const now = new Date();
  const dueSubs = (subs ?? []).filter((s) => {
    const p = localParts(s.timezone, now);
    return p.hour === s.remind_hour && s.last_sent_on !== p.date;
  });

  const stats = { checked: subs?.length ?? 0, eligible: dueSubs.length, sent: 0, nothingDue: 0, expired: 0, errors: 0 };
  const habitCache = new Map<string, { habits: Habit[]; logs: Log[] }>();

  for (const s of dueSubs) {
    const today = localParts(s.timezone, now).date;
    let data = habitCache.get(s.user_id);
    if (!data) {
      const { data: habits } = await admin.from("habits")
        .select("id,name,type,target_value,cadence_type,cadence_config,created_at")
        .eq("user_id", s.user_id).eq("archived", false);
      const ids = (habits ?? []).map((h) => h.id);
      const from = dstr(weekStart(dnum(today)) - 1);
      const { data: logs } = ids.length
        ? await admin.from("habit_logs").select("habit_id,date,completed,value").in("habit_id", ids).gte("date", from)
        : { data: [] as Log[] };
      data = { habits: (habits ?? []) as Habit[], logs: (logs ?? []) as Log[] };
      habitCache.set(s.user_id, data);
    }

    const pending = pendingToday(data.habits, data.logs, s.timezone, today);
    await admin.from("push_subscriptions").update({ last_sent_on: today }).eq("id", s.id);
    if (!pending.length) { stats.nothingDue++; continue; }

    const names = pending.slice(0, 3).join(", ") + (pending.length > 3 ? ` +${pending.length - 3}` : "");
    const r = await send(s, {
      title: pending.length === 1 ? "1 habit still due today" : `${pending.length} habits still due today`,
      body: names,
      tag: "willrot-daily",
      url: "./#/today",
    });
    if (r === "sent") stats.sent++; else if (r === "expired") stats.expired++; else stats.errors++;
  }

  return json(stats);
});
