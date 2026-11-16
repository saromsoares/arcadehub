# Stories

Stories de desenvolvimento da Arcade Hub criadas via `@sm *draft` ou `@sm *create-story`.

## Inventário em 2026-11-16

| Story | Entrega | Status do documento |
| --- | --- | --- |
| [1.1](1.1.story.md) | Rebranding ARCADE CORE | Ready for Review; implementação presente, parecer QA ainda não preenchido |
| [1.2](1.2.story.md) | Sete caixas Hostinger | Done |
| [1.3](1.3.story.md) | Novo e-mail e resposta pela caixa selecionada | Done |
| [1.4](1.4.story.md) | Assinatura visual das sete caixas, incluindo Coben | Publicada; backend/MIME QA PASS; assinaturas conferidas no compositor em 16/11/2026, sem envio |
| [1.5](1.5.story.md) | Portfólio público: De Olho.ai e ClickDrop | Publicada em `3a01a4c`, Vercel READY; visual do site atual conferido em 16/11/2026. O parecer de 30/10 permanece histórico |
| [1.6](1.6.story.md) | Conta Stripe ClickDrop junto da holding | Código `e2ac35e` publicado READY, conta conectada e venda importada; card e subtotais conferidos no admin em 16/11/2026 |
| [1.7](1.7.story.md) | Segurança, sessão, persistência e rascunhos | Ready for Review; publicada READY. Visual autenticado observado em 16/11/2026; parecer de 14/11 permanece histórico |
| [1.8](1.8.story.md) | Financeiro unificado, conciliação e cenários de caixa | Ready for Review; card Stripe de `12304ab` conferido no admin em 16/11/2026, total e contas Geral/ClickDrop separados |
| [1.9](1.9.story.md) | Inteligência operacional e próxima ação | Ready for Review; publicada READY. Painel, leads e calendário observados em 16/11/2026; parecer de 14/11 permanece histórico |

Estado consolidado e limites de validação: [contexto do projeto](../PROJECT_CONTEXT.md). Atualização de memória/documentação não reabre stories nem altera pareceres históricos.

## Convenção de Nomenclatura

```
{epicNum}.{storyNum}.story.md
```

Exemplos:
- `1.1.story.md` — Epic 1, Story 1
- `2.3.story.md` — Epic 2, Story 3

## Lifecycle

| Status | Owner | Próximo Agente |
|--------|-------|----------------|
| Draft | @sm | @po (validate) |
| Approved | @po | @dev (develop) |
| InProgress | @dev | @qa (review) |
| InReview | @qa | @dev (fix) ou @devops (push) |
| Done | @qa/@devops | — |

## Story Template

Stories seguem o template em `.aiox-core/development/templates/story-tmpl.yaml`.

## Quality Gates

QA decision files ficam em `docs/qa/`:
- `qa/gates/{epicNum}.{storyNum}-{slug}.yml`

## Referências

- Constitution Artigo III — Story-Driven Development
- `.claude/rules/story-lifecycle.md` — transições de status
- `.claude/rules/workflow-execution.md` — Story Development Cycle (SDC)
