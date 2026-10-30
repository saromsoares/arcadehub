# Stories

Stories de desenvolvimento da Arcade Hub criadas via `@sm *draft` ou `@sm *create-story`.

## Inventário em 2026-10-30

| Story | Entrega | Status do documento |
| --- | --- | --- |
| [1.1](1.1.story.md) | Rebranding ARCADE CORE | Ready for Review; implementação presente, parecer QA ainda não preenchido |
| [1.2](1.2.story.md) | Sete caixas Hostinger | Done |
| [1.3](1.3.story.md) | Novo e-mail e resposta pela caixa selecionada | Done |
| [1.4](1.4.story.md) | Assinatura visual das sete caixas, incluindo Coben | Publicada; backend/MIME QA PASS; In Progress pela validação visual interativa pendente |
| [1.5](1.5.story.md) | Portfólio público: De Olho.ai e ClickDrop | Implementada; 13 checks diretos aprovados; In Progress pela validação visual pendente |

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
