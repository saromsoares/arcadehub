-- Apply only AFTER the authenticated email-sync function is deployed and tested.
-- Prerequisites: Vault secret email_sync_cron_token matches EMAIL_SYNC_CRON_TOKEN;
-- email-check has verified at least one mailbox. This file contains no token.
begin;
do $preflight$
begin
  if not exists(select 1 from vault.secrets where name='email_sync_cron_token') then
    raise exception 'Configure the dedicated cron token in Vault first';
  end if;
  if not exists(select 1 from public.email_mailboxes where enabled and imap_verified_at is not null) then
    raise exception 'Verify a mailbox with email-check before scheduling';
  end if;
end
$preflight$;

select cron.schedule(
  'email-sync-incremental',
  '*/3 * * * *',
  $command$
  select net.http_post(
    url := 'https://zdwgwpvlwqtsdgervcof.supabase.co/functions/v1/email-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-email-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='email_sync_cron_token')
    ),
    body := jsonb_build_object('mailbox_id',m.id),
    timeout_milliseconds := 60000
  )
  from public.email_mailboxes m
  where m.enabled and m.imap_verified_at is not null;
  $command$
);
-- Updating a named job preserves its paused state; resume after replacement.
select cron.alter_job(jobid,active := true)
from cron.job where jobname='email-sync-incremental';
commit;
