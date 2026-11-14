-- Existing monthly scheduler executes as the postgres owner, not a browser role.
-- Preserve its body, ownership, cadence and bookkeeping; restrict invocation only.
begin;
revoke all on function public.rollforward_custos_fixos() from public,anon,authenticated;
grant execute on function public.rollforward_custos_fixos() to service_role;

-- Both helpers are SECURITY INVOKER. The trigger already schema-qualifies its
-- classifier; the classifier only uses PostgreSQL builtins. Pin resolution safely.
alter function public.mp_classificar_empresa(text) set search_path='';
alter function public.mp_set_empresa() set search_path='';
commit;
