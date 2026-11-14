-- Stories 1.7/1.9. Apply this migration individually, never with indiscriminate db push.
-- No credential is materialized outside Postgres. Browser roles see metadata only.
begin;

create schema if not exists arcade_private;
revoke all on schema arcade_private from public, anon, authenticated;
grant usage on schema arcade_private to service_role;

create table if not exists arcade_private.access_secrets (
  access_id uuid primary key references public.acessos_empresas(id) on delete cascade,
  secret_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists arcade_private.access_events (
  id uuid primary key default gen_random_uuid(),
  access_id uuid,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('revelar','copiar','create','update','delete','review','clear_secret')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table arcade_private.access_secrets enable row level security;
alter table arcade_private.access_events enable row level security;
revoke all on all tables in schema arcade_private from public, anon, authenticated;
grant all on all tables in schema arcade_private to service_role;

alter table public.acessos_empresas add column if not exists reviewed_at timestamptz;
alter table public.acessos_empresas add column if not exists review_due_at timestamptz;
alter table public.acessos_empresas add column if not exists credential_updated_at timestamptz;
alter table public.acessos_empresas add column if not exists request_id uuid;
create unique index if not exists access_request_id_unique on public.acessos_empresas(request_id) where request_id is not null;
insert into arcade_private.access_secrets(access_id, secret_value)
select id, senha from public.acessos_empresas where senha is not null
on conflict (access_id) do nothing;
do $verify_copy$
begin
  if exists(select 1 from public.acessos_empresas a where a.senha is not null
    and not exists(select 1 from arcade_private.access_secrets s where s.access_id=a.id and s.secret_value=a.senha)) then
    raise exception 'Credential copy verification failed';
  end if;
end
$verify_copy$;
-- Remove the exposed copy only after its private counterpart was verified above.
update public.acessos_empresas set senha=null where senha is not null;
revoke all on public.acessos_empresas from public, anon, authenticated;
grant select(id,empresa_id,empresa_nome,rotulo,url,usuario,obs,ordem,created_at,updated_at,
  reviewed_at,review_due_at,credential_updated_at,request_id) on public.acessos_empresas to authenticated;

create or replace function public.dashboard_access_action(p_actor uuid,p_action text,p_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare a public.acessos_empresas%rowtype; result jsonb; secret_text text; request_uuid uuid;
begin
  if not exists(select 1 from public.usuarios_empresas where user_id=p_actor and empresa_id='arcade_hub') then
    raise exception 'holding_access_required' using errcode='42501';
  end if;
  if p_action='events' then
    return jsonb_build_object('events',coalesce((select jsonb_agg(e) from (
      select id,access_id,actor_id,action,created_at from arcade_private.access_events
      where p_id is null or access_id=p_id order by created_at desc limit 100) e),'[]'::jsonb));
  end if;
  if p_action in ('revelar','copiar') then
    select * into a from public.acessos_empresas where id=p_id;
    if not found then raise exception 'access_not_found' using errcode='P0002'; end if;
    select secret_value into secret_text from arcade_private.access_secrets where access_id=p_id;
    insert into arcade_private.access_events(access_id,actor_id,action) values(p_id,p_actor,p_action);
    return jsonb_build_object('senha',coalesce(secret_text,''));
  end if;
  if p_action='save' then
    request_uuid:=nullif(p_payload->>'request_id','')::uuid;
    if p_id is null then
      if request_uuid is null then raise exception 'request_id_required'; end if;
      perform pg_advisory_xact_lock(hashtextextended(request_uuid::text,0));
      select * into a from public.acessos_empresas where request_id=request_uuid;
      if found then return jsonb_build_object('access',to_jsonb(a)-'senha','replayed',true); end if;
      if nullif(btrim(p_payload->>'empresa_id'),'') is null then raise exception 'empresa_required'; end if;
      insert into public.acessos_empresas(empresa_id,empresa_nome,rotulo,url,usuario,obs,ordem,request_id)
      values(p_payload->>'empresa_id',nullif(btrim(p_payload->>'empresa_nome'),''),coalesce(nullif(btrim(p_payload->>'rotulo'),''),'Painel admin'),
        nullif(p_payload->>'url',''),nullif(p_payload->>'usuario',''),nullif(p_payload->>'obs',''),coalesce((p_payload->>'ordem')::int,0),request_uuid)
      returning * into a;
      insert into arcade_private.access_events(access_id,actor_id,action) values(a.id,p_actor,'create');
    else
      update public.acessos_empresas set
        empresa_id=coalesce(nullif(btrim(p_payload->>'empresa_id'),''),empresa_id),
        empresa_nome=case when p_payload?'empresa_nome' then nullif(btrim(p_payload->>'empresa_nome'),'') else empresa_nome end,
        rotulo=case when p_payload?'rotulo' then coalesce(nullif(btrim(p_payload->>'rotulo'),''),'Painel admin') else rotulo end,
        url=case when p_payload?'url' then nullif(p_payload->>'url','') else url end,
        usuario=case when p_payload?'usuario' then nullif(p_payload->>'usuario','') else usuario end,
        obs=case when p_payload?'obs' then nullif(p_payload->>'obs','') else obs end,
        ordem=case when p_payload?'ordem' then (p_payload->>'ordem')::int else ordem end
      where id=p_id returning * into a;
      if not found then raise exception 'access_not_found' using errcode='P0002'; end if;
      insert into arcade_private.access_events(access_id,actor_id,action) values(a.id,p_actor,'update');
    end if;
    if p_payload?'senha' and length(p_payload->>'senha')>0 then
      insert into arcade_private.access_secrets(access_id,secret_value) values(a.id,p_payload->>'senha')
      on conflict(access_id) do update set secret_value=excluded.secret_value,updated_at=now();
      update public.acessos_empresas set credential_updated_at=now(),senha=null where id=a.id returning * into a;
    end if;
    return jsonb_build_object('access',to_jsonb(a)-'senha');
  end if;
  select * into a from public.acessos_empresas where id=p_id for update;
  if not found then raise exception 'access_not_found' using errcode='P0002'; end if;
  if p_action='delete' then
    insert into arcade_private.access_events(access_id,actor_id,action) values(a.id,p_actor,'delete');
    delete from public.acessos_empresas where id=a.id;
    return jsonb_build_object('deleted',true);
  elsif p_action='review' then
    update public.acessos_empresas set reviewed_at=now(),review_due_at=nullif(p_payload->>'review_due_at','')::timestamptz where id=a.id returning * into a;
    insert into arcade_private.access_events(access_id,actor_id,action) values(a.id,p_actor,'review');
    return jsonb_build_object('access',to_jsonb(a)-'senha');
  elsif p_action='clear_secret' then
    delete from arcade_private.access_secrets where access_id=a.id;
    update public.acessos_empresas set senha=null,credential_updated_at=now() where id=a.id;
    insert into arcade_private.access_events(access_id,actor_id,action) values(a.id,p_actor,'clear_secret');
    return jsonb_build_object('cleared',true);
  end if;
  raise exception 'invalid_action';
end
$function$;
revoke all on function public.dashboard_access_action(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dashboard_access_action(uuid,text,uuid,jsonb) to service_role;

-- New operational fields do not invent earlier status transitions.
alter table public.leads add column if not exists responsavel text;
alter table public.leads add column if not exists proxima_acao text;
alter table public.leads add column if not exists proxima_acao_em timestamptz;
alter table public.leads add column if not exists last_moved_at timestamptz;
alter table public.leads add column if not exists contato_origem_id uuid references public.contatos(id) on delete set null;
alter table public.leads add column if not exists request_id uuid;
update public.leads set last_moved_at=coalesce(updated_at,created_at) where last_moved_at is null;
create unique index if not exists lead_request_unique on public.leads(request_id) where request_id is not null;
create unique index if not exists lead_contact_unique on public.leads(contato_origem_id) where contato_origem_id is not null;
create unique index if not exists lead_email_company_unique on public.leads(empresa_id,lower(btrim(email))) where nullif(btrim(email),'') is not null;
create unique index if not exists lead_phone_company_unique on public.leads(empresa_id,regexp_replace(telefone,'[^0-9]','','g')) where nullif(regexp_replace(telefone,'[^0-9]','','g'),'') is not null;
-- Browser status edits remain supported, while provenance/idempotence are server-owned.
revoke insert,update on public.leads from authenticated;
grant insert(empresa_id,nome,email,telefone,regiao,observacao,status,responsavel,proxima_acao,proxima_acao_em)
  on public.leads to authenticated;
grant update(nome,email,telefone,regiao,observacao,status,responsavel,proxima_acao,proxima_acao_em,updated_at)
  on public.leads to authenticated;
create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  empresa_id text not null,
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id),
  event_type text not null check(event_type in ('created','status_changed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.lead_events enable row level security;
revoke all on public.lead_events from public,anon,authenticated;
grant select on public.lead_events to authenticated;
grant all on public.lead_events to service_role;
create policy lead_events_read on public.lead_events for select to authenticated using(public.user_has_empresa_access(empresa_id));
create index if not exists lead_events_lead_date_idx on public.lead_events(lead_id,created_at desc);
create or replace function arcade_private.lead_change_event() returns trigger language plpgsql security definer set search_path='' as $function$
declare actor uuid;
begin
  actor:=coalesce(nullif(current_setting('arcade.actor_id',true),'')::uuid,auth.uid());
  if tg_when='BEFORE' then
    if tg_op='UPDATE' and old.empresa_id is distinct from new.empresa_id then raise exception 'lead_project_immutable' using errcode='23514'; end if;
    new.last_moved_at:=now(); new.updated_at:=now(); return new;
  end if;
  if tg_op='INSERT' then
    insert into public.lead_events(lead_id,empresa_id,to_status,actor_id,event_type) values(new.id,new.empresa_id,new.status,actor,'created');
  elsif old.status is distinct from new.status then
    insert into public.lead_events(lead_id,empresa_id,from_status,to_status,actor_id,event_type) values(new.id,new.empresa_id,old.status,new.status,actor,'status_changed');
  end if;
  return new;
end
$function$;
drop trigger if exists lead_last_moved on public.leads;
create trigger lead_last_moved before insert or update on public.leads for each row execute function arcade_private.lead_change_event();
drop trigger if exists lead_history on public.leads;
create trigger lead_history after insert or update on public.leads for each row execute function arcade_private.lead_change_event();

create or replace function public.dashboard_lead_action(p_actor uuid,p_action text,p_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare target text; l public.leads%rowtype; e text; phone text; conflicts uuid[]; origin uuid; request_uuid uuid; doc jsonb;
begin
  doc:=coalesce(p_payload->'lead','{}'::jsonb);
  target:=doc->>'empresa_id';
  if p_action='history' then
    select * into l from public.leads where id=p_id;
    if not found then raise exception 'lead_not_found' using errcode='P0002'; end if;
    target:=l.empresa_id;
  elsif p_action='convert_contact' then
    target:=p_payload->>'empresa_id'; origin:=nullif(p_payload->>'contato_id','')::uuid;
    if not exists(select 1 from public.usuarios_empresas where user_id=p_actor and empresa_id='arcade_hub') then raise exception 'holding_access_required' using errcode='42501'; end if;
    if not exists(select 1 from public.contatos where id=origin) then raise exception 'contact_not_found' using errcode='P0002'; end if;
  elsif p_id is not null then
    select * into l from public.leads where id=p_id;
    if not found then raise exception 'lead_not_found' using errcode='P0002'; end if;
    if target is null then target:=l.empresa_id; end if;
    if target<>l.empresa_id then raise exception 'lead_project_immutable'; end if;
  end if;
  if target is null or not exists(select 1 from public.usuarios_empresas where user_id=p_actor and empresa_id=target) then
    raise exception 'project_access_required' using errcode='42501';
  end if;
  if p_action='history' then
    return jsonb_build_object('events',coalesce((select jsonb_agg(x) from (select * from public.lead_events where lead_id=p_id order by created_at desc limit 100)x),'[]'::jsonb));
  end if;
  if p_action not in ('save_lead','convert_contact') then raise exception 'invalid_action'; end if;
  request_uuid:=nullif(p_payload->>'request_id','')::uuid;
  if p_id is null and request_uuid is null then raise exception 'request_id_required'; end if;
  -- A company lock makes email/phone/contact conflict review atomic across tabs.
  perform pg_advisory_xact_lock(hashtextextended('lead:'||target,0));
  if request_uuid is not null and p_id is null then
    select * into l from public.leads where request_id=request_uuid;
    if found then
      if l.empresa_id<>target then raise exception 'request_project_conflict'; end if;
      return jsonb_build_object('lead',to_jsonb(l),'existing',true);
    end if;
  end if;
  if origin is not null then
    select * into l from public.leads where contato_origem_id=origin;
    if found then
      if not exists(select 1 from public.usuarios_empresas where user_id=p_actor and empresa_id=l.empresa_id) then raise exception 'project_access_required' using errcode='42501'; end if;
      return jsonb_build_object('lead',to_jsonb(l),'existing',true);
    end if;
  end if;
  e:=nullif(lower(btrim(doc->>'email')),''); phone:=nullif(regexp_replace(coalesce(doc->>'telefone',''),'[^0-9]','','g'),'');
  select array_agg(id) into conflicts from public.leads where empresa_id=target and (p_id is null or id<>p_id)
    and ((e is not null and lower(btrim(email))=e) or (phone is not null and regexp_replace(coalesce(telefone,''),'[^0-9]','','g')=phone));
  if cardinality(conflicts)>0 then return jsonb_build_object('conflict_ids',to_jsonb(conflicts),'error','duplicate_lead_review_required'); end if;
  if nullif(btrim(doc->>'nome'),'') is null then raise exception 'lead_name_required'; end if;
  if coalesce(doc->>'status','novo') not in ('novo','em_contato','qualificado','proposta','ganho','perdido') then raise exception 'invalid_lead_status'; end if;
  perform set_config('arcade.actor_id',p_actor::text,true);
  if p_id is null then
    insert into public.leads(empresa_id,nome,email,telefone,regiao,observacao,status,responsavel,proxima_acao,proxima_acao_em,contato_origem_id,request_id)
    values(target,btrim(doc->>'nome'),e,nullif(btrim(doc->>'telefone'),''),nullif(doc->>'regiao',''),nullif(doc->>'observacao',''),coalesce(doc->>'status','novo'),
      nullif(btrim(doc->>'responsavel'),''),nullif(btrim(doc->>'proxima_acao'),''),nullif(doc->>'proxima_acao_em','')::timestamptz,origin,request_uuid) returning * into l;
  else
    update public.leads set nome=btrim(doc->>'nome'),email=e,telefone=nullif(btrim(doc->>'telefone'),''),regiao=nullif(doc->>'regiao',''),
      observacao=nullif(doc->>'observacao',''),status=coalesce(doc->>'status','novo'),responsavel=nullif(btrim(doc->>'responsavel'),''),
      proxima_acao=nullif(btrim(doc->>'proxima_acao'),''),proxima_acao_em=nullif(doc->>'proxima_acao_em','')::timestamptz,updated_at=now()
      where id=p_id returning * into l;
  end if;
  return jsonb_build_object('lead',to_jsonb(l));
end
$function$;
revoke all on function public.dashboard_lead_action(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dashboard_lead_action(uuid,text,uuid,jsonb) to service_role;

create table if not exists public.socio_reembolsos (
  id uuid primary key default gen_random_uuid(),
  socio text not null check(socio in ('SAROM','GLADIOMIR','LUIZ')),
  valor numeric(14,2) not null check(valor>0),
  data_pagamento date not null,
  referencia text not null,
  observacao text,
  origem_ref text,
  status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
  request_id uuid not null unique,
  created_by uuid not null references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.socio_reembolsos enable row level security;
revoke all on public.socio_reembolsos from public,anon,authenticated;
grant select on public.socio_reembolsos to authenticated;
grant all on public.socio_reembolsos to service_role;
create policy socio_reembolsos_read on public.socio_reembolsos for select to authenticated
using(public.user_has_empresa_access('arcade_hub') and not public.pagina_bloqueada('balanco'));
create index if not exists reimbursement_socio_date_idx on public.socio_reembolsos(socio,data_pagamento);

create or replace function public.dashboard_reimbursement_action(p_actor uuid,p_action text,p_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare r public.socio_reembolsos%rowtype; doc jsonb; who text; amount numeric; paid date; yr int; personal numeric; reimbursed numeric; request_uuid uuid;
begin
  if not exists(select 1 from public.usuarios_empresas where user_id=p_actor and empresa_id='arcade_hub') then raise exception 'holding_access_required' using errcode='42501'; end if;
  if exists(select 1 from public.usuarios_paginas_bloqueadas where user_id=p_actor and 'balanco'=any(paginas)) then raise exception 'page_blocked' using errcode='42501'; end if;
  if p_action='list' then
    yr:=coalesce((p_payload->>'ano')::int,extract(year from current_date)::int);
    return jsonb_build_object('reimbursements',coalesce((select jsonb_agg(x) from (select * from public.socio_reembolsos where extract(year from data_pagamento)=yr order by data_pagamento desc,created_at desc)x),'[]'::jsonb));
  end if;
  if p_action='cancel' then
    if length(btrim(coalesce(p_payload->>'reason','')))<3 then raise exception 'cancellation_reason_required'; end if;
    update public.socio_reembolsos set status='cancelled',cancelled_at=now(),cancelled_by=p_actor,cancel_reason=left(p_payload->>'reason',500),updated_at=now()
      where id=p_id and status='confirmed' returning * into r;
    if not found then select * into r from public.socio_reembolsos where id=p_id; end if;
    if r.id is null then raise exception 'reimbursement_not_found' using errcode='P0002'; end if;
    return jsonb_build_object('reimbursement',to_jsonb(r));
  end if;
  if p_action<>'record' then raise exception 'invalid_action'; end if;
  doc:=p_payload->'payment'; who:=doc->>'socio'; amount:=(doc->>'valor')::numeric; paid:=(doc->>'data_pagamento')::date;
  request_uuid:=nullif(p_payload->>'request_id','')::uuid;
  if request_uuid is null then raise exception 'request_id_required'; end if;
  if who is null or who not in ('SAROM','GLADIOMIR','LUIZ') or amount is null or amount<=0 or amount<>round(amount,2) or paid is null or paid>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid_reimbursement'; end if;
  if nullif(btrim(doc->>'referencia'),'') is null then raise exception 'reference_required'; end if;
  yr:=extract(year from paid)::int;
  perform pg_advisory_xact_lock(hashtextextended('reimbursement:'||who||':'||yr,0));
  select * into r from public.socio_reembolsos where request_id=request_uuid;
  if found then return jsonb_build_object('reimbursement',to_jsonb(r),'replayed',true); end if;
  select coalesce(sum(valor),0) into personal from public.custos_extras where ano=yr and pagador=who
    and nullif(meio_pagamento,'') is not null and meio_pagamento<>'cartao_empresa'
    and empresa_id in ('arcade_hub','priva_br','coben_life_os','clickdrop','liquida_pecas','jogadaca','giromob','conferecheck');
  select personal+coalesce(sum(coalesce(custos_diretos,0)+coalesce(folha,0)+coalesce(impostos,0)+coalesce(despesas_adm,0)+coalesce(outras_despesas,0)),0)
    into personal from public.lancamentos where ano=yr and pagador=who
    and nullif(meio_pagamento,'') is not null and meio_pagamento<>'cartao_empresa'
    and empresa_id in ('arcade_hub','priva_br','coben_life_os','clickdrop','liquida_pecas','jogadaca','giromob','conferecheck');
  select coalesce(sum(valor),0) into reimbursed from public.socio_reembolsos where socio=who and extract(year from data_pagamento)=yr and status='confirmed';
  if amount>greatest(0,personal-reimbursed) then raise exception 'reimbursement_exceeds_pending' using errcode='23514'; end if;
  if nullif(doc->>'origem_ref','') is not null and not exists(select 1 from public.custos_extras where id::text=doc->>'origem_ref' and ano=yr and pagador=who
    and nullif(meio_pagamento,'') is not null and meio_pagamento<>'cartao_empresa'
    and empresa_id in ('arcade_hub','priva_br','coben_life_os','clickdrop','liquida_pecas','jogadaca','giromob','conferecheck')) then raise exception 'invalid_expense_reference'; end if;
  insert into public.socio_reembolsos(socio,valor,data_pagamento,referencia,observacao,origem_ref,request_id,created_by)
  values(who,amount,paid,left(btrim(doc->>'referencia'),300),left(doc->>'observacao',2000),nullif(doc->>'origem_ref',''),request_uuid,p_actor) returning * into r;
  return jsonb_build_object('reimbursement',to_jsonb(r));
end
$function$;
revoke all on function public.dashboard_reimbursement_action(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dashboard_reimbursement_action(uuid,text,uuid,jsonb) to service_role;

alter table public.custos_extras add column if not exists gateway_receipt_ref text;
create unique index if not exists cost_gateway_ref_unique on public.custos_extras(ano,empresa_id,gateway_receipt_ref) where gateway_receipt_ref is not null;
create unique index if not exists cost_recurrence_month_unique on public.custos_extras(ano,mes,empresa_id,recorrencia_id) where recorrencia_id is not null;
create or replace function arcade_private.guard_recurrence_company() returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if tg_op='UPDATE' and old.recorrencia_id is not null and old.empresa_id is distinct from new.empresa_id then
    raise exception 'recurrence_project_immutable' using errcode='23514';
  end if;
  if new.recorrencia_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('recurrence:'||new.recorrencia_id::text,0));
    if exists(select 1 from public.custos_extras where recorrencia_id=new.recorrencia_id and id<>new.id and empresa_id<>new.empresa_id) then
      raise exception 'recurrence_project_immutable' using errcode='23514';
    end if;
  end if;
  return new;
end
$function$;
create trigger guard_recurrence_company before insert or update on public.custos_extras for each row execute function arcade_private.guard_recurrence_company();

-- Optional project link; legacy calendar actions retain their unclassified context.
alter table public.calendario_acoes add column if not exists empresa_id text;
create index if not exists calendar_project_date_idx on public.calendario_acoes(empresa_id,data) where empresa_id is not null;
create or replace function arcade_private.guard_calendar_company() returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.empresa_id is not null then
    if new.empresa_id not in ('arcade_hub','priva_br','coben_life_os','clickdrop','liquida_pecas','jogadaca','giromob','conferecheck') then
      raise exception 'invalid_calendar_project' using errcode='23514';
    end if;
    if auth.uid() is not null and not public.user_has_empresa_access(new.empresa_id) then
      raise exception 'calendar_project_access_required' using errcode='42501';
    end if;
  end if;
  return new;
end
$function$;
create trigger guard_calendar_company before insert or update on public.calendario_acoes for each row execute function arcade_private.guard_calendar_company();

-- Only new replies receive the validated link; historical messages remain unknown.
alter table public.emails add column if not exists reply_to_id bigint references public.emails(id) on delete set null;
create index if not exists emails_reply_parent_idx on public.emails(mailbox_id,reply_to_id) where reply_to_id is not null;
create or replace function arcade_private.guard_email_reply() returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.reply_to_id is not null and not exists(select 1 from public.emails p where p.id=new.reply_to_id and p.mailbox_id=new.mailbox_id and p.direcao='in') then
    raise exception 'invalid_mailbox_reply' using errcode='23514';
  end if;
  return new;
end
$function$;
create trigger guard_email_reply before insert or update of reply_to_id,mailbox_id on public.emails for each row execute function arcade_private.guard_email_reply();

comment on table arcade_private.access_secrets is 'Server-only credentials. Never expose through Data API schemas.';
comment on table public.lead_events is 'Prospective transitions since dashboard evolution; not reconstructed historical conversion.';
comment on table public.socio_reembolsos is 'Records payments already made. Does not initiate transfers or duplicate costs.';
revoke all on all functions in schema arcade_private from public,anon,authenticated;
commit;
