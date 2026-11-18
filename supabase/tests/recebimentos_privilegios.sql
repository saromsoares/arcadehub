begin;

do $qa$
declare
  tabela regclass;
begin
  foreach tabela in array array['public.mp_recebimentos'::regclass, 'public.stripe_recebimentos'::regclass]
  loop
    assert not has_table_privilege('anon', tabela, 'SELECT, UPDATE, INSERT, DELETE, TRUNCATE');
    assert has_table_privilege('authenticated', tabela, 'SELECT');
    assert not has_table_privilege('authenticated', tabela, 'UPDATE, INSERT, DELETE, TRUNCATE');
    assert has_column_privilege('authenticated', tabela, 'empresa_id', 'UPDATE');
    assert not has_column_privilege('authenticated', tabela, 'valor', 'UPDATE');
    assert not has_column_privilege('authenticated', tabela, 'status', 'UPDATE');
    assert not has_column_privilege('authenticated', tabela, 'raw', 'UPDATE');
    assert has_table_privilege('service_role', tabela, 'SELECT');
    assert has_table_privilege('service_role', tabela, 'UPDATE');
    assert has_table_privilege('service_role', tabela, 'INSERT');
  end loop;
  raise notice 'Permissões de recebimentos validadas';
end;
$qa$;

rollback;
