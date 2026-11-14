-- Local synthetic bootstrap only. Does not execute the recurring-cost scheduler.
begin;
do $qa$
begin
  assert not has_function_privilege('anon','public.rollforward_custos_fixos()','EXECUTE'),'anonymous scheduler mutation denied';
  assert not has_function_privilege('authenticated','public.rollforward_custos_fixos()','EXECUTE'),'browser scheduler mutation denied';
  assert has_function_privilege('postgres','public.rollforward_custos_fixos()','EXECUTE'),'owner cron remains authorized';
  assert has_function_privilege('service_role','public.rollforward_custos_fixos()','EXECUTE'),'server scheduler remains authorized';
  assert (select array['search_path=""']::text[]<@proconfig from pg_proc where oid='public.mp_classificar_empresa(text)'::regprocedure),'classifier resolution fixed';
  assert (select array['search_path=""']::text[]<@proconfig from pg_proc where oid='public.mp_set_empresa()'::regprocedure),'trigger resolution fixed';
  assert public.mp_classificar_empresa('Synthetic Priva test')='priva_br','classification preserved';
  assert public.mp_classificar_empresa('Unrelated synthetic description') is null,'unmatched classification preserved';
  insert into public.mp_recebimentos(descricao,empresa_id) values('Priva fixture',null);
  assert exists(select 1 from public.mp_recebimentos where descricao='Priva fixture' and empresa_id='priva_br'),'trigger still classifies synthetic insert';
  insert into public.mp_recebimentos(descricao,empresa_id) values('Priva fixture explicit','clickdrop');
  assert exists(select 1 from public.mp_recebimentos where descricao='Priva fixture explicit' and empresa_id='clickdrop'),'explicit destination preserved';
  raise notice 'Legacy function grants/search_path PASS';
end
$qa$;
rollback;
