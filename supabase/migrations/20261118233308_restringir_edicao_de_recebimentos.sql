begin;

-- O dashboard classifica o recebimento. Valores, situação e dados de origem
-- continuam sob a responsabilidade das integrações no servidor.
revoke all privileges on table public.mp_recebimentos, public.stripe_recebimentos
  from public, anon, authenticated;
grant select on table public.mp_recebimentos, public.stripe_recebimentos
  to authenticated;
grant update (empresa_id) on table public.mp_recebimentos, public.stripe_recebimentos
  to authenticated;

commit;
