-- Willrot — hourly reminder trigger (pg_cron + pg_net → Edge Function)
-- Run AFTER deploying the `send-reminders` Edge Function and setting its secrets.
-- Replace <CRON_SECRET> with the same value you set as the function's CRON_SECRET secret.
-- (The secret is stored in Supabase Vault so it never sits in the cron job text.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store / rotate the shared secret in Vault
do $$
begin
  if exists (select 1 from vault.secrets where name = 'willrot_cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'willrot_cron_secret'), '<CRON_SECRET>');
  else
    perform vault.create_secret('<CRON_SECRET>', 'willrot_cron_secret');
  end if;
end $$;

-- (Re)schedule: top of every hour. The function only pushes to subscriptions
-- whose local hour equals their chosen reminder hour, once per local day.
select cron.unschedule(jobid) from cron.job where jobname = 'willrot-send-reminders';
select cron.schedule(
  'willrot-send-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://rhfomdlzvwemtuczlwgu.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'willrot_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
