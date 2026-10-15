-- Story 1.2: separate mailbox identity and IMAP UID namespaces.
-- Prerequisite: existing public.emails and user_has_empresa_access(text).
-- This migration does not change cron or assert that credentials are configured.
begin;

create table if not exists public.email_mailboxes (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,47}$'),
  email text unique,
  label text not null check (length(label) between 1 and 120),
  is_legacy boolean not null default false,
  enabled boolean not null default true,
  credentials_revision bigint not null default 0 check (credentials_revision >= 0),
  imap_verified_at timestamptz,
  smtp_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_mailboxes_address_check check (
    (email is not null and email = lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (email is null and is_legacy)
  ),
  constraint email_mailboxes_legacy_id_check check (is_legacy = (id = 'arcade_hub'))
);
alter table public.email_mailboxes add column if not exists credentials_revision bigint not null default 0 check (credentials_revision >= 0);

comment on table public.email_mailboxes is
  'Mailbox inventory only; passwords remain in Edge Function secrets. Access follows existing Arcade Hub membership.';
comment on column public.email_mailboxes.email is
  'Legacy address remains NULL until server validates its existing IMAP/SMTP configuration; never infer from historical recipient headers.';
comment on column public.email_mailboxes.imap_verified_at is
  'Set by server after successful IMAP authentication; NULL means unverified.';
comment on column public.email_mailboxes.smtp_verified_at is
  'Set by server after successful SMTP authentication without sending a message; NULL means unverified.';
comment on column public.email_mailboxes.credentials_revision is
  'Increment before rotating credentials and clear verification timestamps. Verification updates must compare the captured revision to reject stale concurrent checks.';

insert into public.email_mailboxes (id,email,label,is_legacy) values
  ('arcade_hub',null,'Arcade Hub',true),
  ('cbai_solutions','suporte@cbaisolutions.com.br','CBAI Solutions',false),
  ('jogadaca','contato@jogadaca.ai','JogadaCA',false),
  ('coben','contato@coben.app','Coben',false),
  ('privabr','suporte@privabr.com.br','PrivaBR',false),
  ('liquida_pecas','contato@liquidapecas.com.br','Líquida Peças',false),
  ('conferecheck','contato@conferecheck.com.br','ConfereCheck',false)
on conflict (id) do nothing;

alter table public.emails add column if not exists mailbox_id text default 'arcade_hub';
alter table public.emails add column if not exists imap_uidvalidity bigint;
update public.emails set mailbox_id='arcade_hub' where mailbox_id is null;
alter table public.emails alter column mailbox_id set not null;
-- Record the send attempt before contacting SMTP; a pending record is not proof
-- of delivery and must never be retried automatically after an ambiguous result.
alter table public.emails drop constraint if exists emails_status_check;
alter table public.emails add constraint emails_status_check
  check (status in ('enviado','falha','recebido','rascunho','pendente'));

do $migration$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.emails'::regclass and conname='emails_mailbox_id_fkey') then
    alter table public.emails add constraint emails_mailbox_id_fkey
      foreign key (mailbox_id) references public.email_mailboxes(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.emails'::regclass and conname='emails_imap_uidvalidity_check') then
    alter table public.emails add constraint emails_imap_uidvalidity_check
      check (imap_uidvalidity is null or imap_uidvalidity between 1 and 4294967295);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.emails'::regclass and conname='emails_new_mailbox_epoch_check') then
    alter table public.emails add constraint emails_new_mailbox_epoch_check
      check (mailbox_id='arcade_hub' or uid_imap is null or imap_uidvalidity is not null);
  end if;
end
$migration$;

comment on column public.emails.mailbox_id is
  'Explicit mailbox ownership. Default arcade_hub exists only for the rollout compatibility window.';
comment on column public.emails.imap_uidvalidity is
  'IMAP UIDVALIDITY for the folder encoded in uid_imap. Legacy NULL must be reconciled against Message-ID before adoption; never assign the current epoch blindly.';

-- Create scoped constraints before dropping the old global uniqueness rule.
create unique index if not exists emails_mailbox_epoch_uid_uq
  on public.emails(mailbox_id,imap_uidvalidity,uid_imap);
create unique index if not exists emails_mailbox_legacy_uid_uq
  on public.emails(mailbox_id,uid_imap)
  where imap_uidvalidity is null and uid_imap is not null;
create index if not exists emails_mailbox_created_idx
  on public.emails(mailbox_id,created_at desc);
drop index if exists public.emails_uid_imap_uq;

create or replace function public.touch_email_mailboxes()
returns trigger language plpgsql security invoker set search_path='' as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;
revoke all on function public.touch_email_mailboxes() from public,anon,authenticated;
drop trigger if exists email_mailboxes_updated_at on public.email_mailboxes;
create trigger email_mailboxes_updated_at before update on public.email_mailboxes
  for each row execute function public.touch_email_mailboxes();

alter table public.email_mailboxes enable row level security;
alter table public.emails enable row level security;

revoke all on public.email_mailboxes from public,anon,authenticated;
grant select on public.email_mailboxes to authenticated;
grant all on public.email_mailboxes to service_role;

drop policy if exists email_mailboxes_select_holding on public.email_mailboxes;
create policy email_mailboxes_select_holding on public.email_mailboxes
  for select to authenticated
  using (enabled and (select public.user_has_empresa_access('arcade_hub')));

-- Only the server may change message identity/content or insert deliveries.
-- The existing browser uses UPDATE(lido) and DELETE, both scoped by RLS.
revoke all on public.emails from public,anon,authenticated;
grant select,delete on public.emails to authenticated;
grant update(lido) on public.emails to authenticated;
grant all on public.emails to service_role;

drop policy if exists emails_select_holding on public.emails;
drop policy if exists emails_insert_holding on public.emails;
drop policy if exists emails_update_holding on public.emails;
drop policy if exists emails_delete_holding on public.emails;
drop policy if exists emails_select_mailbox on public.emails;
drop policy if exists emails_update_mailbox on public.emails;
drop policy if exists emails_delete_mailbox on public.emails;
create policy emails_select_mailbox on public.emails for select to authenticated
  using (exists (select 1 from public.email_mailboxes m where m.id=emails.mailbox_id and m.enabled));
create policy emails_update_mailbox on public.emails for update to authenticated
  using (exists (select 1 from public.email_mailboxes m where m.id=emails.mailbox_id and m.enabled))
  with check (exists (select 1 from public.email_mailboxes m where m.id=emails.mailbox_id and m.enabled));
create policy emails_delete_mailbox on public.emails for delete to authenticated
  using (exists (select 1 from public.email_mailboxes m where m.id=emails.mailbox_id and m.enabled));

-- Supabase filters row visibility using the SELECT policy above.
-- DELETE events may contain only the PK; the UI reloads its filtered inbox.
do $publication$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='emails') then
    alter publication supabase_realtime add table public.emails;
  end if;
end
$publication$;

commit;
