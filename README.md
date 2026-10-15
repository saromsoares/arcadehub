# Arcade Hub

Site institucional ARCADE CORE e dashboard financeiro/operacional da holding. Frontends em HTML/CSS/JS vanilla; backend do admin em Supabase. Produção: [site](https://arcadehub.tech/) · [dashboard](https://arcadehub.tech/admin/).

## Retomar o projeto

- [Contexto atual](docs/PROJECT_CONTEXT.md): código, empresas, sete caixas de e-mail, entregas, verificações e limites conhecidos.
- [Operação de e-mail](docs/runbooks/email-operacao.md): uso, acesso técnico, credenciais, deploy e diagnóstico.
- [Arquitetura](docs/architecture/README.md), [stories](docs/stories/README.md) e [pareceres QA](docs/qa/README.md).
- [Migrações](supabase/migrations/README.md): estado aplicado e cuidados com a diferença entre histórico local e remoto.

`index.html` contém a home e `admin/index.html` contém o dashboard. Não há build do site; validar mudanças de interface no navegador. As funções de e-mail têm testes Deno em `supabase/tests/`. Alterações de documentação exigem revisão de conteúdo, referências e diff.

O push em `main` dispara deploy Vercel; Edge Functions têm publicação separada. Seguir as instruções de agentes locais para autoridade de publicação. Nunca versionar senhas, tokens, perfis de acesso ou conteúdo privado das caixas.
