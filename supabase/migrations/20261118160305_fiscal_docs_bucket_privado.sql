-- Bucket privado para documentos societários/fiscais da holding (contêm CPF/RG/endereço dos sócios).
-- Leitura somente para usuários com acesso à holding; sem política de escrita para o navegador
-- (o upload é feito pelo servidor/CLI com chave de serviço).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fiscal-docs', 'fiscal-docs', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fiscal_docs_holding_select on storage.objects;
create policy fiscal_docs_holding_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'fiscal-docs' and public.user_has_empresa_access('arcade_hub'));
