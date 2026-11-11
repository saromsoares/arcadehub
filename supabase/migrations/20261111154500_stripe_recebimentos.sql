-- Stripe receipts for the holding dashboard. Mirrors mp_recebimentos:
-- the sync writer uses the service role; the logged-in holding user can
-- read rows and assign empresa_id. No db push: local and remote histories differ.

create table if not exists public.stripe_recebimentos (
  id              uuid primary key default gen_random_uuid(),
  stripe_id       text not null unique,
  status          text,
  status_detail   text,
  tipo_pagamento  text,
  descricao       text,
  valor           numeric,
  valor_liquido   numeric,
  taxa            numeric,
  moeda           text,
  payer_email     text,
  payer_nome      text,
  date_approved   timestamptz,
  date_created    timestamptz,
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  empresa_id      text
);

create index if not exists stripe_recebimentos_approved_idx
  on public.stripe_recebimentos (date_approved desc);

alter table public.stripe_recebimentos enable row level security;

drop policy if exists stripe_recebimentos_select_holding on public.stripe_recebimentos;
create policy stripe_recebimentos_select_holding on public.stripe_recebimentos
  for select to authenticated
  using (public.user_has_empresa_access('arcade_hub'));

drop policy if exists stripe_recebimentos_update_holding on public.stripe_recebimentos;
create policy stripe_recebimentos_update_holding on public.stripe_recebimentos
  for update to authenticated
  using (public.user_has_empresa_access('arcade_hub'))
  with check (public.user_has_empresa_access('arcade_hub'));

revoke all on public.stripe_recebimentos from public, anon, authenticated;
grant select, update on public.stripe_recebimentos to authenticated;

do $publication$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stripe_recebimentos'
  ) then
    alter publication supabase_realtime add table public.stripe_recebimentos;
  end if;
end
$publication$;
