-- Apply only after stripe-sync is deployed and Vault secret stripe_sync_key
-- matches the edge secret STRIPE_SYNC_KEY. This file contains no token.
begin;
do $preflight$
begin
  if not exists(select 1 from vault.secrets where name = 'stripe_sync_key') then
    raise exception 'Configure the dedicated Stripe sync key in Vault first';
  end if;
end
$preflight$;

select cron.schedule(
  'stripe-sync-incremental',
  '*/2 * * * *',
  $command$
  select net.http_post(
    url := 'https://zdwgwpvlwqtsdgervcof.supabase.co/functions/v1/stripe-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-stripe-sync-key',(select decrypted_secret from vault.decrypted_secrets where name='stripe_sync_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $command$
);
select cron.alter_job(jobid, active := true)
from cron.job where jobname = 'stripe-sync-incremental';
commit;
