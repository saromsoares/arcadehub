# Arquitetura da Arcade Hub

Ponto de entrada: [contexto atual](../PROJECT_CONTEXT.md), atualizado em 2026-10-15. Documentos mantidos a partir da implementação e das decisões de @architect.

## Documentação existente

- [E-mail multicaixas](email-multicaixas.md): discovery, autorização, credenciais, IMAP, SMTP, respostas, sessão e concorrência.
- [Banco de e-mails](email-multicaixas-database.md): migração aplicada, RLS, identidade IMAP, testes e limites de rollback.
- [Operação de e-mail](../runbooks/email-operacao.md): acesso CLI, uso, credenciais, deploy e diagnóstico.
- [Histórico de migrações](../../supabase/migrations/README.md).

## Convenções da Arcade Hub

Home ARCADE CORE em HTML/SVG/CSS vanilla; admin single-file com Supabase JS SDK e Chart.js. Backend Supabase Postgres/Auth/RLS/Realtime e Edge Functions Deno no projeto `zdwgwpvlwqtsdgervcof`. Build estático dispensado; testes direcionados ao escopo.

Empresas públicas vêm dos cards semânticos que alimentam `PORTFOLIO`; empresas financeiras de `COMPANIES`; caixas autorizadas de `email-accounts`. Esses inventários têm finalidades distintas.

Não existem neste checkout os documentos genéricos `system-architecture.md`, `tech-stack.md` ou `data-architecture.md` nem uma coleção de ADRs. A listagem antiga desses arquivos era um modelo de estrutura, não evidência de sua criação. Novas decisões arquiteturais pertencem a @architect; esta atualização consolida decisões já aprovadas.
