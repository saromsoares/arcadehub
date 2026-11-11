-- Per-user page blocks. A missing row means the user keeps every page.
-- Mercado Pago and Stripe stay unreadable for a blocked user. The other
-- blocked pages are hidden in the dashboard; their source rows remain
-- available to the overview screens.

create table if not exists public.usuarios_paginas_bloqueadas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  paginas text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.usuarios_paginas_bloqueadas enable row level security;

drop policy if exists usuarios_paginas_bloqueadas_select_self on public.usuarios_paginas_bloqueadas;
create policy usuarios_paginas_bloqueadas_select_self
  on public.usuarios_paginas_bloqueadas
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.usuarios_paginas_bloqueadas from public, anon, authenticated;
grant select on public.usuarios_paginas_bloqueadas to authenticated;

create or replace function public.pagina_bloqueada(p_pagina text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.usuarios_paginas_bloqueadas
    where user_id = auth.uid()
      and p_pagina = any (paginas)
  );
$$;

revoke all on function public.pagina_bloqueada(text) from public;
grant execute on function public.pagina_bloqueada(text) to authenticated;

drop policy if exists mp_recebimentos_pagina on public.mp_recebimentos;
create policy mp_recebimentos_pagina
  on public.mp_recebimentos
  as restrictive
  for all
  to authenticated
  using (not public.pagina_bloqueada('mercadopago'))
  with check (not public.pagina_bloqueada('mercadopago'));

drop policy if exists stripe_recebimentos_pagina on public.stripe_recebimentos;
create policy stripe_recebimentos_pagina
  on public.stripe_recebimentos
  as restrictive
  for all
  to authenticated
  using (not public.pagina_bloqueada('stripe'))
  with check (not public.pagina_bloqueada('stripe'));
