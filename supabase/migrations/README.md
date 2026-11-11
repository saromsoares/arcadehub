# Migrações Supabase

Projeto `zdwgwpvlwqtsdgervcof`. Estado consolidado em 2026-10-15.

| Arquivo | Estado conhecido |
| --- | --- |
| `20260522_000001_enable_rls_baseline.sql` | Baseline RLS aplicado em 2026-05-22, conforme histórico do projeto; nome local legado. |
| `20261015182925_email_multicaixas.sql` | Aplicado em 2026-10-15, testes transacionais remotos aprovados e versão `20261015182925` registrada no histórico. |
| `20261110124500_leads.sql` | Aplicado em 2026-11-10 por `db query` isolado e versão `20261110124500` registrada. Tabela `leads` com RLS por empresa. Em 2026-11-11 o `revoke` passou a incluir `authenticated` antes do `grant` de `select, insert, update, delete`; o ajuste foi aplicado com `db query`, sem `db push` e sem versão nova. |
| `20261111154500_stripe_recebimentos.sql` | Aplicado em 2026-11-11 por `db query` isolado e versão `20261111154500` registrada. Tabela `stripe_recebimentos`, RLS da holding e Realtime. No mesmo dia o cron `stripe-sync-incremental` foi agendado a cada 2 minutos, depois que `STRIPE_SECRET_KEY` e `stripe_sync_key` existiam. |
| `20261111180000_paginas_bloqueadas.sql` | Aplicado em 2026-11-11 por `db query` isolado e versão `20261111180000` registrada. Tabela `usuarios_paginas_bloqueadas` (o próprio usuário lê a própria linha) e policies restritivas em `mp_recebimentos` e `stripe_recebimentos`. Sem linha, o usuário continua com todas as páginas. O vínculo do usuário e a lista de páginas ficam fora desta migração. |

## Histórico local e remoto

O checkout não contém todas as migrações remotas: havia 18 versões remotas anteriores à migração multicaixas. Elas não foram reparadas, apagadas ou reaplicadas. **Não executar `db push` indiscriminadamente** nem marcar versões desconhecidas como aplicadas/revertidas para forçar igualdade.

A migração multicaixas foi criada pelo CLI, revisada e aplicada isoladamente via `supabase db query --linked --project-ref ... --file`. Depois dos testes e da inspeção, somente sua versão foi registrada com `migration repair --status applied`. Esse é o registro do procedimento concluído, não uma instrução para repetir a aplicação em produção.

Novas migrações devem ser geradas com `supabase migration new <nome>` e revisadas com o estado real do banco antes de aplicar. Não renomear o baseline antigo apenas por estética. Usar o perfil isolado do [runbook de operação](../../docs/runbooks/email-operacao.md), sem novo login desnecessário.

## Validação e retorno

Modelo, RLS, identidade e evidências: [banco multicaixas](../../docs/architecture/email-multicaixas-database.md). A suite `supabase/tests/email_multicaixas.sql` usa transação com rollback e fixtures sintéticas. O cron tem configuração própria em `supabase/operations/email-sync-cron.sql`.

O rollback `supabase/operations/email-multicaixas-rollback.sql` só serve antes de mensagens adicionais/identidades incompatíveis; **não usar no estado atual com sete caixas importadas**. Preferir preservar o esquema aditivo ao reverter aplicação.

Outros runbooks: [rotação JWT](../../docs/runbooks/jwt-rotation.md). Esta atualização de documentação não altera schema, secrets, cron ou histórico remoto.
