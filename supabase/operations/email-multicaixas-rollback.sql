-- Emergency schema rollback, only BEFORE additional mailboxes contain messages.
-- Prefer retaining the additive schema when rolling back application code.
-- Inspect the ignored pre-migration snapshot before using this operation.
begin;
lock table public.emails in access exclusive mode;
do $preflight$
begin
  if exists(select 1 from public.emails where status='pendente') then
    raise exception 'Rollback refused: pending send attempts need reconciliation first';
  end if;
  if exists(select 1 from public.emails where mailbox_id <> 'arcade_hub') then
    raise exception 'Rollback refused: additional mailbox data exists; retain the scoped schema';
  end if;
  if exists(select uid_imap from public.emails where uid_imap is not null group by uid_imap having count(*) > 1) then
    raise exception 'Rollback refused: different IMAP epochs reuse UIDs; retain the scoped schema';
  end if;
end
$preflight$;

create unique index if not exists emails_uid_imap_uq
  on public.emails(uid_imap) where uid_imap is not null;
drop policy if exists emails_select_mailbox on public.emails;
drop policy if exists emails_update_mailbox on public.emails;
drop policy if exists emails_delete_mailbox on public.emails;
drop policy if exists emails_select_holding on public.emails;
drop policy if exists emails_insert_holding on public.emails;
drop policy if exists emails_update_holding on public.emails;
drop policy if exists emails_delete_holding on public.emails;
create policy emails_select_holding on public.emails for select to authenticated
  using(public.user_has_empresa_access('arcade_hub'));
create policy emails_insert_holding on public.emails for insert to authenticated
  with check(public.user_has_empresa_access('arcade_hub'));
create policy emails_update_holding on public.emails for update to authenticated
  using(public.user_has_empresa_access('arcade_hub'))
  with check(public.user_has_empresa_access('arcade_hub'));
create policy emails_delete_holding on public.emails for delete to authenticated
  using(public.user_has_empresa_access('arcade_hub'));
revoke update(lido) on public.emails from authenticated;
grant all on public.emails to anon,authenticated,service_role;
alter table public.emails drop constraint if exists emails_status_check;
alter table public.emails add constraint emails_status_check
  check (status in ('enviado','falha','recebido','rascunho'));

drop index if exists public.emails_mailbox_epoch_uid_uq;
drop index if exists public.emails_mailbox_legacy_uid_uq;
drop index if exists public.emails_mailbox_created_idx;
alter table public.emails drop constraint if exists emails_new_mailbox_epoch_check;
alter table public.emails drop constraint if exists emails_imap_uidvalidity_check;
alter table public.emails drop constraint if exists emails_mailbox_id_fkey;
alter table public.emails drop column if exists imap_uidvalidity;
alter table public.emails drop column if exists mailbox_id;
drop table if exists public.email_mailboxes;
drop function if exists public.touch_email_mailboxes();
do $publication$
begin
  if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='emails') then
    alter publication supabase_realtime drop table public.emails;
  end if;
end
$publication$;
commit;
