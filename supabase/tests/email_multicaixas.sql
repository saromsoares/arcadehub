-- Run against a migrated database. Fixtures and all changes are rolled back.
-- Does not read or print real message contents or send mail.
begin;

create temporary table email_test_context as
select (select user_id from public.usuarios_empresas where empresa_id='arcade_hub' limit 1) as owner_id,
       gen_random_uuid() as outsider_id;
grant select on email_test_context to authenticated;

do $test$
begin
  if (select owner_id is null from email_test_context) then
    raise exception 'A holding member is required for the positive RLS test';
  end if;
  if exists(select 1 from public.usuarios_empresas where user_id=(select outsider_id from email_test_context)) then
    raise exception 'Unexpected fixture user collision';
  end if;
  if exists(select 1 from public.emails where id between -910010 and -910001) then
    raise exception 'Fixture IDs already exist';
  end if;
end
$test$;

insert into public.email_mailboxes(id,email,label,enabled)
values ('test_disabled','fixture-disabled@example.invalid','Test disabled',false);
insert into public.emails(id,mailbox_id,direcao,uid_imap,imap_uidvalidity,lido)
overriding system value values
  (-910001,'arcade_hub','in','INBOX:4294967000',100,false),
  (-910002,'cbai_solutions','in','INBOX:4294967000',100,false),
  (-910003,'cbai_solutions','in','INBOX:4294967000',101,false),
  (-910004,'test_disabled','in','INBOX:4294967000',100,false),
  (-910005,'arcade_hub','in','INBOX:4294967001',null,false);
insert into public.emails(id,mailbox_id,direcao,status)
overriding system value values (-910007,'arcade_hub','out','pendente');

-- Different mailbox and different UIDVALIDITY both accept the same UID.
do $test$
begin
  begin
    insert into public.emails(id,direcao,status)
    overriding system value values (-910006,'out','invalid_status');
    raise exception 'Invalid delivery status was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.emails(id,mailbox_id,direcao,uid_imap,imap_uidvalidity)
    overriding system value values (-910006,'cbai_solutions','in','INBOX:4294967000',100);
    raise exception 'Duplicate mailbox/epoch/UID was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.emails(id,mailbox_id,direcao,uid_imap)
    overriding system value values (-910006,'arcade_hub','in','INBOX:4294967001');
    raise exception 'Duplicate legacy UID was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.emails(id,mailbox_id,direcao,uid_imap)
    overriding system value values (-910006,'cbai_solutions','in','INBOX:4294967002');
    raise exception 'New mailbox accepted a missing UIDVALIDITY';
  exception when check_violation then null;
  end;
  begin
    insert into public.emails(id,mailbox_id,direcao,uid_imap,imap_uidvalidity)
    overriding system value values (-910006,'cbai_solutions','in','INBOX:4294967002',0);
    raise exception 'Invalid UIDVALIDITY was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.emails(id,mailbox_id,direcao)
    overriding system value values (-910006,'missing_mailbox','out');
    raise exception 'Missing mailbox foreign key was accepted';
  exception when foreign_key_violation then null;
  end;
end
$test$;

-- A valid holding member can read all enabled boxes, including pending setup.
do $test$ begin
  perform set_config('request.jwt.claim.sub',(select owner_id::text from email_test_context),true);
end $test$;
set local role authenticated;
do $test$
declare changed integer;
begin
  if (select count(*) from public.emails where id between -910005 and -910001) <> 4 then
    raise exception 'Holding member visibility mismatch';
  end if;
  if exists(select 1 from public.email_mailboxes where id='test_disabled') then
    raise exception 'Disabled mailbox was visible';
  end if;
  update public.emails set lido=true where id=-910001 and mailbox_id='cbai_solutions';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Wrong mailbox filter changed message'; end if;
  update public.emails set lido=true where id=-910001 and mailbox_id='arcade_hub';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Authorized mark-read failed'; end if;
  delete from public.emails where id=-910003 and mailbox_id='cbai_solutions';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Authorized deletion failed'; end if;
  begin
    update public.emails set mailbox_id='cbai_solutions' where id=-910001;
    raise exception 'Client could reassign message mailbox';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.emails set corpo_texto='tampered' where id=-910001;
    raise exception 'Client could rewrite message body';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.emails(direcao) values ('out');
    raise exception 'Client could forge a delivered message';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.email_mailboxes set imap_verified_at=now() where id='cbai_solutions';
    raise exception 'Client could claim mailbox verification';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.email_mailboxes set credentials_revision=credentials_revision+1 where id='cbai_solutions';
    raise exception 'Client could alter credential revision';
  exception when insufficient_privilege then null;
  end;
end
$test$;
reset role;

-- An authenticated user without holding membership sees and changes nothing.
do $test$ begin
  perform set_config('request.jwt.claim.sub',(select outsider_id::text from email_test_context),true);
end $test$;
set local role authenticated;
do $test$
declare changed integer;
begin
  if exists(select 1 from public.email_mailboxes) or exists(select 1 from public.emails) then
    raise exception 'Unauthorized authenticated user could read mailbox data';
  end if;
  update public.emails set lido=true where id=-910002;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Unauthorized user marked a message'; end if;
  delete from public.emails where id=-910002;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Unauthorized user deleted a message'; end if;
end
$test$;
reset role;

set local role anon;
do $test$
begin
  begin
    perform 1 from public.emails limit 1;
    raise exception 'Anonymous read was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.email_mailboxes limit 1;
    raise exception 'Anonymous mailbox discovery was allowed';
  exception when insufficient_privilege then null;
  end;
end
$test$;
reset role;

rollback;
select 'PASS: mailbox scope, IMAP uniqueness, holding authorization, column privileges, anonymous denial; fixtures rolled back' as result;
