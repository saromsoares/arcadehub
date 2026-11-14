-- Apply after migration stripe_history_coverage and the new stripe-sync handler.
-- Existing dedicated Vault token; no credentials in this file.
begin;
select cron.schedule('stripe-sync-historical','17 */6 * * *',$command$
  select net.http_post(
    url := 'https://zdwgwpvlwqtsdgervcof.supabase.co/functions/v1/stripe-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-stripe-sync-key',(select decrypted_secret from vault.decrypted_secrets where name='stripe_sync_key')),
    body := '{"historical":true}'::jsonb, timeout_milliseconds := 100000
  );
$command$);
select cron.alter_job(jobid, active := true) from cron.job where jobname='stripe-sync-historical';
commit;
