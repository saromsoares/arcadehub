-- Run against an isolated database populated with the local fixture bootstrap.
-- Uses only synthetic values; never run this fixture suite over production data.
begin;
do $test$
<<checks>>
declare owner_id uuid:='00000000-0000-4000-8000-000000000001';
  outsider uuid:='00000000-0000-4000-8000-000000000002';
  blocked uuid:='00000000-0000-4000-8000-000000000003';
  original uuid:='10000000-0000-4000-8000-000000000001';
  created uuid; lead_id uuid; contact_id uuid; result jsonb; replay jsonb; event_count int;
  req uuid:=gen_random_uuid(); refund_request uuid:=gen_random_uuid(); recurrence uuid:=gen_random_uuid(); parent bigint; other_parent bigint;
begin
  assert not has_column_privilege('authenticated','public.acessos_empresas','senha','SELECT'),'password SELECT denied';
  assert has_column_privilege('authenticated','public.acessos_empresas','usuario','SELECT'),'metadata SELECT preserved';
  assert not has_table_privilege('authenticated','public.acessos_empresas','UPDATE'),'direct mutations denied';
  assert not has_schema_privilege('authenticated','arcade_private','USAGE'),'private schema denied';
  assert not has_function_privilege('authenticated','public.dashboard_access_action(uuid,text,uuid,jsonb)','EXECUTE'),'RPC denied to browser';
  assert not has_function_privilege('anon','public.dashboard_lead_action(uuid,text,uuid,jsonb)','EXECUTE'),'anonymous RPC denied';
  assert exists(select 1 from arcade_private.access_secrets where access_id=original and secret_value='fixture-only'),'credential preserved server-side';
  assert (select senha is null from public.acessos_empresas where id=original),'public credential copy cleared after verified private copy';
  result:=public.dashboard_access_action(owner_id,'revelar',original);
  assert result->>'senha'='fixture-only','authorized service RPC reveals fixture';
  assert exists(select 1 from arcade_private.access_events where access_id=original and actor_id=owner_id and action='revelar'),'reveal audited';
  begin
    perform public.dashboard_access_action(outsider,'revelar',original);
    raise exception 'expected unauthorized error';
  exception when insufficient_privilege then null; end;
  result:=public.dashboard_access_action(owner_id,'save',null,jsonb_build_object('request_id',req,'empresa_id','clickdrop','empresa_nome','Fixture','senha','new-fixture'));
  created:=(result->'access'->>'id')::uuid;
  assert not (result->'access'?'senha'),'metadata never returns credential';
  replay:=public.dashboard_access_action(owner_id,'save',null,jsonb_build_object('request_id',req,'empresa_id','clickdrop','senha','overwrite-attempt'));
  assert (replay->'access'->>'id')::uuid=created and (replay->>'replayed')::boolean,'creation replay idempotent';
  assert (select secret_value from arcade_private.access_secrets where access_id=created)='new-fixture','replay does not overwrite secret';
  perform public.dashboard_access_action(owner_id,'save',created,'{"rotulo":"Metadata only"}'::jsonb);
  assert (select secret_value from arcade_private.access_secrets where access_id=created)='new-fixture','omitted secret preserved';
  perform public.dashboard_access_action(owner_id,'review',created,'{"review_due_at":"2027-01-01T12:00:00Z"}'::jsonb);
  assert (select reviewed_at is not null from public.acessos_empresas where id=created),'review server timestamp';
  perform public.dashboard_access_action(owner_id,'delete',created);
  assert not exists(select 1 from arcade_private.access_secrets where access_id=created),'delete removes private credential';
  assert exists(select 1 from arcade_private.access_events where access_id=created and action='delete'),'delete audit retained';

  req:=gen_random_uuid();
  result:=public.dashboard_lead_action(owner_id,'save_lead',null,jsonb_build_object('request_id',req,'lead',jsonb_build_object('empresa_id','clickdrop','nome','Synthetic lead','email',' Test@Example.invalid ','telefone','(11) 5555-0000','status','novo','responsavel','Equipe','proxima_acao','Retornar')));
  lead_id:=(result->'lead'->>'id')::uuid;
  assert result->'lead'->>'email'='test@example.invalid','email normalized';
  replay:=public.dashboard_lead_action(owner_id,'save_lead',null,jsonb_build_object('request_id',req,'lead',jsonb_build_object('empresa_id','clickdrop','nome','Replay')));
  assert replay->'lead'->>'id'=lead_id::text,'lead replay idempotent';
  result:=public.dashboard_lead_action(owner_id,'save_lead',lead_id,jsonb_build_object('request_id',req,'lead',jsonb_build_object('empresa_id','clickdrop','nome','Reviewed lead','email','test@example.invalid','telefone','1155550000','status','novo')));
  assert result->'lead'->>'nome'='Reviewed lead','editing an existing lead does not replay its creation';
  result:=public.dashboard_lead_action(owner_id,'save_lead',null,jsonb_build_object('request_id',gen_random_uuid(),'lead',jsonb_build_object('empresa_id','clickdrop','nome','Duplicate','email','TEST@example.invalid','telefone','1155550000')));
  assert result->>'error'='duplicate_lead_review_required' and jsonb_array_length(result->'conflict_ids')=1,'duplicate requires explicit review';
  update public.leads set status='em_contato' where id=lead_id;
  select count(*) into event_count from public.lead_events where lead_events.lead_id=checks.lead_id;
  assert event_count=2,'prospective create and status transition recorded';
  assert exists(select 1 from public.leads where id=lead_id and last_moved_at is not null),'last movement exists';
  result:=public.dashboard_lead_action(owner_id,'history',lead_id);
  assert jsonb_array_length(result->'events')=2,'history returned for authorized project';
  begin
    perform public.dashboard_lead_action(blocked,'history',lead_id);
    raise exception 'expected project denial';
  exception when insufficient_privilege then null; end;
  insert into public.contatos(nome,email) values('Synthetic contact','contact@example.invalid') returning id into contact_id;
  req:=gen_random_uuid();
  result:=public.dashboard_lead_action(owner_id,'convert_contact',null,jsonb_build_object('request_id',req,'contato_id',contact_id,'empresa_id','clickdrop','lead',jsonb_build_object('nome','Reviewed contact','email','contact@example.invalid')));
  replay:=public.dashboard_lead_action(owner_id,'convert_contact',null,jsonb_build_object('request_id',gen_random_uuid(),'contato_id',contact_id,'empresa_id','clickdrop','lead',jsonb_build_object('nome','Do not overwrite')));
  assert replay->'lead'->>'id'=result->'lead'->>'id' and replay->'lead'->>'nome'='Reviewed contact','contact replay cannot overwrite edits';

  insert into public.custos_extras(empresa_id,ano,mes,valor,pagador,meio_pagamento) values('clickdrop',extract(year from current_date)::int,'Nov',300,'SAROM','pix');
  result:=public.dashboard_reimbursement_action(owner_id,'record',null,jsonb_build_object('request_id',refund_request,'payment',jsonb_build_object('socio','SAROM','valor',200,'data_pagamento',current_date,'referencia','Fixture payment already made')));
  replay:=public.dashboard_reimbursement_action(owner_id,'record',null,jsonb_build_object('request_id',refund_request,'payment',jsonb_build_object('socio','SAROM','valor',200,'data_pagamento',current_date,'referencia','Replay')));
  assert result->'reimbursement'->>'id'=replay->'reimbursement'->>'id','reimbursement replay one payment';
  begin
    perform public.dashboard_reimbursement_action(owner_id,'record',null,jsonb_build_object('request_id',gen_random_uuid(),'payment',jsonb_build_object('socio','SAROM','valor',101,'data_pagamento',current_date,'referencia','Overpayment')));
    raise exception 'expected balance cap';
  exception when check_violation then null; end;
  begin
    perform public.dashboard_reimbursement_action(blocked,'list',null,'{}'::jsonb);
    raise exception 'expected blocked page';
  exception when insufficient_privilege then null; end;
  perform public.dashboard_reimbursement_action(owner_id,'cancel',(result->'reimbursement'->>'id')::uuid,'{"reason":"Fixture correction"}'::jsonb);
  assert (select status from public.socio_reembolsos where id=(result->'reimbursement'->>'id')::uuid)='cancelled','correction retains cancelled record';
  insert into public.custos_extras(empresa_id,ano,mes,valor,pagador,meio_pagamento) values
    ('clickdrop',extract(year from current_date)::int,'Nov',100,'LUIZ','cartao_empresa'),
    ('clickdrop',extract(year from current_date)::int,'Nov',100,'LUIZ','pix'),
    ('clickdrop',extract(year from current_date)::int,'Nov',100,'LUIZ',''),
    ('gironamaxima',extract(year from current_date)::int,'Nov',100,'LUIZ','pix');
  insert into public.lancamentos(empresa_id,ano,mes,custos_diretos,pagador,meio_pagamento) values
    ('clickdrop',extract(year from current_date)::int,'Nov',100,'LUIZ','cartao_empresa');
  begin
    perform public.dashboard_reimbursement_action(owner_id,'record',null,jsonb_build_object('request_id',gen_random_uuid(),'payment',jsonb_build_object('socio','LUIZ','valor',101,'data_pagamento',current_date,'referencia','Company card excluded')));
    raise exception 'expected personal obligation cap 100';
  exception when check_violation then null; end;
  result:=public.dashboard_reimbursement_action(owner_id,'record',null,jsonb_build_object('request_id',gen_random_uuid(),'payment',jsonb_build_object('socio','LUIZ','valor',100,'data_pagamento',current_date,'referencia','Personal pix only')));
  assert (result->'reimbursement'->>'valor')::numeric=100,'personal expense definition matches displayed obligation';

  insert into public.custos_extras(empresa_id,ano,mes,valor,recorrencia_id) values('clickdrop',2026,'Out',10,recurrence);
  begin
    update public.custos_extras set empresa_id='priva_br' where recorrencia_id=recurrence;
    raise exception 'expected single-item series project guard';
  exception when check_violation then null; end;
  begin
    insert into public.custos_extras(empresa_id,ano,mes,valor,recorrencia_id) values('priva_br',2026,'Nov',10,recurrence);
    raise exception 'expected series project guard';
  exception when check_violation then null; end;
  begin
    insert into public.custos_extras(empresa_id,ano,mes,valor,recorrencia_id) values('clickdrop',2026,'Out',10,recurrence);
    raise exception 'expected duplicate parcel denial';
  exception when unique_violation then null; end;
  insert into public.calendario_acoes(data,titulo) values(current_date,'Unclassified historical fixture');
  insert into public.calendario_acoes(data,titulo,empresa_id) values(current_date,'Service fixture','clickdrop');
  begin
    insert into public.calendario_acoes(data,titulo,empresa_id) values(current_date,'Invalid fixture','coben');
    raise exception 'expected invalid calendar project';
  exception when check_violation then null; end;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  insert into public.calendario_acoes(data,titulo,empresa_id) values(current_date,'Authorized destination fixture','clickdrop');
  begin
    insert into public.calendario_acoes(data,titulo,empresa_id) values(current_date,'Unauthorized destination fixture','priva_br');
    raise exception 'expected calendar destination authorization';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','',true);
  insert into public.emails(mailbox_id,direcao) values('alpha','in') returning id into parent;
  insert into public.emails(mailbox_id,direcao,reply_to_id) values('alpha','out',parent);
  begin
    insert into public.emails(mailbox_id,direcao,reply_to_id) values('beta','out',parent);
    raise exception 'expected foreign mailbox reply denial';
  exception when check_violation then null; end;
  raise notice 'Dashboard secure operations SQL: all assertions PASS';
end
$test$;
rollback;
