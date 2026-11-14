-- Story 1.8. Apply individually; never db push this divergent history.
begin;
create table if not exists public.stripe_sync_state (
  account_key text primary key check (account_key in ('arcade_hub', 'clickdrop')),
  account_id text not null,
  cursor_full text,
  full_started_at timestamptz,
  full_completed_at timestamptz,
  last_checked_at timestamptz,
  error_sanitized text,
  reviewed_count integer not null default 0 check (reviewed_count >= 0),
  lease_token uuid,
  lease_until timestamptz
);
alter table public.stripe_sync_state enable row level security;
revoke all on public.stripe_sync_state from public, anon, authenticated;
grant select (account_key,account_id,cursor_full,full_started_at,full_completed_at,last_checked_at,error_sanitized,reviewed_count)
  on public.stripe_sync_state to authenticated;
grant all on public.stripe_sync_state to service_role;
create policy stripe_sync_state_select_holding on public.stripe_sync_state
  for select to authenticated
  using (public.user_has_empresa_access('arcade_hub') and not public.pagina_bloqueada('stripe'));

-- The service key is only in the Edge Function. Leases serialize cron/manual rounds.
create or replace function public.stripe_history_claim(p_account_key text, p_account_id text, p_start boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare s public.stripe_sync_state; token uuid;
begin
  if p_account_key not in ('arcade_hub','clickdrop') or p_account_id !~ '^acct_[a-zA-Z0-9]+$' then
    raise exception 'Invalid account identity';
  end if;
  insert into public.stripe_sync_state(account_key, account_id) values(p_account_key,p_account_id)
    on conflict (account_key) do nothing;
  select * into s from public.stripe_sync_state where account_key=p_account_key for update;
  if s.account_id <> p_account_id then raise exception 'Account identity mismatch'; end if;
  if s.lease_until > now() then return null; end if;
  if s.full_started_at is null or s.full_completed_at >= s.full_started_at then
    if not p_start then return null; end if;
    s.full_started_at := now(); s.cursor_full := null; s.reviewed_count := 0;
  end if;
  token := gen_random_uuid();
  update public.stripe_sync_state set full_started_at=s.full_started_at, cursor_full=s.cursor_full,
    reviewed_count=s.reviewed_count, lease_token=token, lease_until=now()+interval '110 seconds'
    where account_key=p_account_key returning * into s;
  return to_jsonb(s);
end;
$function$;

create or replace function public.stripe_history_checkpoint(
  p_account_key text, p_lease_token uuid, p_cursor text, p_completed boolean,
  p_reviewed integer, p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  update public.stripe_sync_state set
    cursor_full=case when p_error is not null then cursor_full when p_completed then null else p_cursor end,
    full_completed_at=case when p_completed and p_error is null then now() else full_completed_at end,
    reviewed_count=reviewed_count+case when p_error is null then greatest(0,p_reviewed) else 0 end,
    last_checked_at=now(), error_sanitized=left(p_error,200), lease_token=null, lease_until=null
    where account_key=p_account_key and lease_token=p_lease_token;
  return found;
end;
$function$;
revoke all on function public.stripe_history_claim(text,text,boolean) from public, anon, authenticated;
revoke all on function public.stripe_history_checkpoint(text,uuid,text,boolean,integer,text) from public, anon, authenticated;
grant execute on function public.stripe_history_claim(text,text,boolean) to service_role;
grant execute on function public.stripe_history_checkpoint(text,uuid,text,boolean,integer,text) to service_role;
commit;
