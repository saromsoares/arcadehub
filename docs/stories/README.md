# Stories

Stories de desenvolvimento da Arcade Hub criadas via `@sm *draft` ou `@sm *create-story`.

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
