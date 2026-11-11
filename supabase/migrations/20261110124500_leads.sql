-- Leads comerciais por projeto do dashboard.
-- empresa_id segue o mesmo identificador de COMPANIES e de usuarios_empresas.
-- A lista de status é fechada para o quadro não receber etapa desconhecida.

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  text not null check (char_length(empresa_id) between 1 and 48),
  nome        text not null check (char_length(nome) between 1 and 160),
  email       text check (email is null or char_length(email) between 3 and 160),
  regiao      text check (regiao is null or char_length(regiao) between 1 and 120),
  telefone    text check (telefone is null or char_length(telefone) between 1 and 40),
  observacao  text check (observacao is null or char_length(observacao) <= 4000),
  status      text not null default 'novo'
              check (status in ('novo','em_contato','qualificado','proposta','ganho','perdido')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists leads_empresa_status_idx
  on public.leads (empresa_id, status, created_at desc);

alter table public.leads enable row level security;

drop policy if exists leads_select_own_empresa on public.leads;
create policy leads_select_own_empresa on public.leads
  for select to authenticated
  using (public.user_has_empresa_access(empresa_id));

drop policy if exists leads_insert_own_empresa on public.leads;
create policy leads_insert_own_empresa on public.leads
  for insert to authenticated
  with check (public.user_has_empresa_access(empresa_id));

drop policy if exists leads_update_own_empresa on public.leads;
create policy leads_update_own_empresa on public.leads
  for update to authenticated
  using (public.user_has_empresa_access(empresa_id))
  with check (public.user_has_empresa_access(empresa_id));

drop policy if exists leads_delete_own_empresa on public.leads;
create policy leads_delete_own_empresa on public.leads
  for delete to authenticated
  using (public.user_has_empresa_access(empresa_id));

revoke all on public.leads from public, anon, authenticated;
grant select, insert, update, delete on public.leads to authenticated;
