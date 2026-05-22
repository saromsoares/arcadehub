-- =====================================================================
-- Migration: enable RLS baseline (admin dashboard hardening)
-- Created:   2026-05-22
-- Author:    @data-engineer (Dara) via Claude Code
-- Story:     security-baseline-arcadehub
-- =====================================================================
-- CONTEXTO:
--   - Tabelas afetadas já tinham RLS habilitado, mas TODAS as policies
--     eram permissivas (qual=true), efetivamente um bucket único.
--   - custos_extras tinha policy "Allow all for anon" → JWT anon vazado
--     conseguia ler/escrever sem login.
--
-- MUDANÇA:
--   - Dropa todas as policies permissivas atuais.
--   - Cria tabela usuarios_empresas (pivô user ↔ empresa).
--   - Função user_has_empresa_access(empresa_id text).
--   - Policies por empresa_id em lancamentos, planejado, custos_extras.
--   - Policies holding-level (apenas user com acesso a 'arcade_hub') em
--     estrutura e calendario_acoes (não têm coluna empresa_id).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DROP policies permissivas existentes
-- ---------------------------------------------------------------------
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('lancamentos','planejado','custos_extras','estrutura','calendario_acoes')
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- 2. Tabela de pivô user <-> empresa
-- ---------------------------------------------------------------------
create table if not exists public.usuarios_empresas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  empresa_id  text not null,
  role        text not null default 'viewer'
              check (role in ('owner','admin','viewer')),
  created_at  timestamptz not null default now(),
  unique (user_id, empresa_id)
);

create index if not exists usuarios_empresas_user_idx     on public.usuarios_empresas(user_id);
create index if not exists usuarios_empresas_empresa_idx  on public.usuarios_empresas(empresa_id);

alter table public.usuarios_empresas enable row level security;

drop policy if exists "ue_select_self" on public.usuarios_empresas;
create policy "ue_select_self" on public.usuarios_empresas
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. Função helper: acesso à empresa
-- ---------------------------------------------------------------------
create or replace function public.user_has_empresa_access(p_empresa_id text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios_empresas
    where user_id = auth.uid() and empresa_id = p_empresa_id
  );
$$;

revoke all on function public.user_has_empresa_access(text) from public;
grant execute on function public.user_has_empresa_access(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Policies por empresa_id (lancamentos, planejado, custos_extras)
-- ---------------------------------------------------------------------
do $$
declare
  tbl text;
  tbls text[] := array['lancamentos','planejado','custos_extras'];
begin
  foreach tbl in array tbls loop
    execute format('alter table public.%I enable row level security', tbl);

    execute format($p$
      create policy "%s_select_own_empresa" on public.%I
        for select to authenticated
        using (public.user_has_empresa_access(empresa_id))
    $p$, tbl, tbl);

    execute format($p$
      create policy "%s_insert_own_empresa" on public.%I
        for insert to authenticated
        with check (public.user_has_empresa_access(empresa_id))
    $p$, tbl, tbl);

    execute format($p$
      create policy "%s_update_own_empresa" on public.%I
        for update to authenticated
        using (public.user_has_empresa_access(empresa_id))
        with check (public.user_has_empresa_access(empresa_id))
    $p$, tbl, tbl);

    execute format($p$
      create policy "%s_delete_own_empresa" on public.%I
        for delete to authenticated
        using (public.user_has_empresa_access(empresa_id))
    $p$, tbl, tbl);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- 5. Policies holding-level (estrutura, calendario_acoes)
--    Acesso liberado apenas a quem tem entrada com empresa_id='arcade_hub'
-- ---------------------------------------------------------------------
alter table public.estrutura enable row level security;

create policy "estrutura_holding_select" on public.estrutura
  for select to authenticated
  using (public.user_has_empresa_access('arcade_hub'));

create policy "estrutura_holding_insert" on public.estrutura
  for insert to authenticated
  with check (public.user_has_empresa_access('arcade_hub'));

create policy "estrutura_holding_update" on public.estrutura
  for update to authenticated
  using (public.user_has_empresa_access('arcade_hub'))
  with check (public.user_has_empresa_access('arcade_hub'));

create policy "estrutura_holding_delete" on public.estrutura
  for delete to authenticated
  using (public.user_has_empresa_access('arcade_hub'));

alter table public.calendario_acoes enable row level security;

create policy "calendario_holding_select" on public.calendario_acoes
  for select to authenticated
  using (public.user_has_empresa_access('arcade_hub'));

create policy "calendario_holding_insert" on public.calendario_acoes
  for insert to authenticated
  with check (public.user_has_empresa_access('arcade_hub'));

create policy "calendario_holding_update" on public.calendario_acoes
  for update to authenticated
  using (public.user_has_empresa_access('arcade_hub'))
  with check (public.user_has_empresa_access('arcade_hub'));

create policy "calendario_holding_delete" on public.calendario_acoes
  for delete to authenticated
  using (public.user_has_empresa_access('arcade_hub'));

-- =====================================================================
-- FIM da migration. Próximo passo: popular usuarios_empresas (script
-- separado para auditoria — ver docs/runbooks/jwt-rotation.md).
-- =====================================================================
