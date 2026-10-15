# Banco de e-mails multicaixas

Story 1.2. Projeto `zdwgwpvlwqtsdgervcof`, em 2026-10-15. Migração `20261015182925` aplicada após revisão, com histórico registrado e testes transacionais remotos aprovados. A conexão das caixas e a publicação das funções são etapas independentes.

## Estado observado

- PostgreSQL 17.6; `emails` contém 66 recebidos e 3 enviados. Os três enviados registram `suporte@arcadehub.tech` como remetente. Isso confirma o histórico SMTP, sem comprovar a identidade IMAP atual.
- Os 66 recebidos têm `uid_imap` no formato `INBOX:n`, e Message-ID presente e distinto. A unicidade existente é global em `uid_imap`; não existe UIDVALIDITY armazenada.
- RLS de SELECT/INSERT/UPDATE/DELETE depende de `user_has_empresa_access('arcade_hub')`. Há um vínculo de proprietário da holding. `usuarios_empresas` permite ler apenas vínculos do usuário atual.
- `emails` ainda não pertence à publicação Realtime. A migração a adiciona caso a publicação exista e a tabela ainda não faça parte dela.
- Job `email-sync-incremental`, ID 3, ativo a cada três minutos, chama a função sem Authorization e sem Vault. `pg_cron`, `pg_net` e `supabase_vault` estão instalados; não havia secrets no Vault. O comando completo não foi exportado para documentação pública.
- Snapshot de colunas, índices, constraints, políticas, grants e publicação: `.aiox/email-schema-before-20261015.json`. Não contém conteúdo de mensagens ou credenciais.

## Modelo

`email_mailboxes` contém inventário sem senhas. IDs: `arcade_hub`, `cbai_solutions`, `jogadaca`, `coben`, `privabr`, `liquida_pecas`, `conferecheck`. A caixa legada mantém `email=NULL` até a função confirmar a configuração existente. As seis adicionais têm os endereços exatos informados pelo usuário.

`enabled` é uma decisão administrativa de acesso; não significa que uma senha funciona. `imap_verified_at` e `smtp_verified_at` registram autenticação validada no servidor, sem enviar mensagens. O discovery combina esses estados com a presença do secret para apresentar capacidades. Novas contas sem credencial permanecem visíveis como pendentes. Somente o servidor altera inventário/verificações. Ao trocar a senha, incrementar `credentials_revision` e limpar as verificações antes de atualizar o secret e verificar novamente. O `email-check` captura essa revisão e só grava o resultado se ela continuar igual; uma verificação concorrente de senha antiga não pode restaurar o estado validado depois da rotação.

As mensagens recebem `mailbox_id NOT NULL`, FK sem cascade. O default `arcade_hub` mantém as funções antigas durante a transição. Todos os registros anteriores pertencem à integração legada; o backfill não decide sua identidade pelo campo destinatário.

O status `pendente` registra a tentativa antes da chamada SMTP. Somente confirmação do transporte permite `enviado`; resultados ambíguos não devem causar retry automático. O rollback recusa remover esse estado enquanto houver tentativas pendentes que precisam de conciliação.

`imap_uidvalidity` é bigint positivo até 4294967295. NULL preserva a época desconhecida do legado. Unicidade nova: `(mailbox_id, imap_uidvalidity, uid_imap)`, além de índice parcial `(mailbox_id, uid_imap)` para a época NULL. Como `uid_imap` contém a pasta (`INBOX:n`), as identidades não colidem entre pastas, épocas ou contas. Novas caixas não aceitam UID sem UIDVALIDITY.

A sincronização só pode adotar a época atual de um registro legado após comparar seu Message-ID com a mensagem correspondente no servidor. Divergências preservam a mensagem histórica; o corpo remoto não pode ser associado pelo UID antigo isoladamente. O backend ignora qualquer UID fornecido pelo navegador como fonte de autorização.

## Permissões

Preserva-se o modelo autorizado existente: membros da holding acessam caixas habilitadas. Vínculo apenas com uma empresa filha não concede acesso ao módulo de e-mails. A interface escolhe uma caixa por operação; o usuário da holding continua autorizado às demais.

RLS das mensagens exige existência da caixa visível em `email_mailboxes`, cuja política exige membership da holding. Nenhuma nova função `SECURITY DEFINER` foi introduzida. A função de atualização de timestamp usa `SECURITY INVOKER`, search_path vazio e execução pública revogada.

O navegador mantém SELECT, DELETE e UPDATE apenas da coluna `lido`. Identidade, conteúdo, inserções e estados de credencial são exclusivos do servidor. A chave service role contorna RLS, portanto as Edge Functions precisam validar usuário, membership e mailbox antes de qualquer operação privilegiada.

## Aplicação e retorno

1. Conferir o snapshot e aplicar `supabase/migrations/20261015182925_email_multicaixas.sql` na transação fornecida.
2. Executar `supabase/tests/email_multicaixas.sql`: dados sintéticos com IDs negativos, comparação de identidades, cenários positivos/negativos de RLS e rollback final. Não envia e-mail nem imprime conteúdo real.
3. Publicar funções com autenticação interna. Coordenar o cron para não manter chamadas anônimas após exigir autenticação.
4. Configurar token dedicado em Edge secret `EMAIL_SYNC_CRON_TOKEN` e no Vault com nome `email_sync_cron_token`; validar pelo `email-check` as contas configuradas.
5. Aplicar separadamente `supabase/operations/email-sync-cron.sql`, que chama apenas contas habilitadas com IMAP verificado. O token vai no header `x-email-cron-token`; é aceito exclusivamente em `email-sync`.

O rollback de aplicação deve preferir conservar o esquema aditivo. `supabase/operations/email-multicaixas-rollback.sql` só serve antes de existirem mensagens de caixas adicionais e recusa UIDs duplicados entre épocas. Ele restaura as políticas/grants originais; não usar depois da ativação multicaixas. O cron autenticado precisa ser pausado/revertido separadamente se as funções forem revertidas.

## Verificação local

Docker PostgreSQL 17, com esquema mínimo equivalente ao inspecionado e dados inteiramente fictícios. Migração, reaplicação, rollback e suite transacional executados com `ON_ERROR_STOP=1`: aprovados. A suite verifica isolamento de UID entre contas/épocas, rejeição de duplicados, constraints, leitura e alterações permitidas ao membro da holding, caixa desabilitada, tentativa de reatribuição/content tampering, inserção/forja de verificação e revisão de credencial pelo cliente, usuário sem vínculo e acesso anônimo. O guard de rollback com envio pendente também foi exercitado e recusou a operação.

## Verificação remota

Após aplicar exclusivamente o arquivo desta story por `supabase db query --linked --project-ref ... --file`, a mesma suite transacional passou no projeto real. A inspeção posterior confirmou 69 mensagens preservadas (66 recebidas/3 enviadas), todas vinculadas ao legado, as 66 épocas IMAP desconhecidas ainda NULL, sete caixas, índices escopados, RLS nas duas tabelas e publicação Realtime. Não restaram fixtures. O cron permaneceu inalterado nessa etapa.

Foi registrado apenas `20261015182925` como aplicado usando `migration repair --status applied`, com confirmação por consulta ao histórico. As 18 migrações remotas anteriores não foram reparadas ou modificadas; não foi usado `db push` contra o histórico local divergente. Nenhum conteúdo de mensagem foi impresso e nenhum e-mail foi enviado nos testes.

Após validar IMAP/SMTP do legado e publicar as funções autenticadas, o job 3 foi atualizado com token dedicado vindo do Vault, body explícito por mailbox e filtro de contas com IMAP verificado. A pausa durante o deploy foi revertida explicitamente, porque `cron.schedule` preserva o estado pausado ao atualizar um job nomeado. O agendamento continua a cada três minutos.

Primeiro tick autenticado confirmado em 2026-10-15 18:45 UTC: job 3 com status `succeeded`, resposta HTTP 200, `ok=true`, `novos=0`, sem timeout. As 69 mensagens foram preservadas; 60 mensagens legadas tiveram a época IMAP reconciliada e seis permaneceram sem época conhecida. Nenhum conteúdo de mensagem foi exposto nessa verificação.

Referências oficiais: [RLS e grants](https://supabase.com/docs/guides/database/postgres/row-level-security), [agendamento de Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions). O changelog de [Postgres 15.19/17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) foi consultado; esta migração não usa as extensões ou operadores afetados descritos ali.
