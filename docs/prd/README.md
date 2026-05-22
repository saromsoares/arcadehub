# Product Requirement Documents (PRDs)

PRDs e épicos da Arcade Hub criados via `@pm *create-prd` ou `@pm *create-epic`.

## Estrutura

```
prd/
├── README.md                   (este arquivo)
├── prd.md                      (PRD principal — sharded em subdiretórios)
├── shards/                     (PRD fragmentado por área)
└── epics/
    └── epic-{NNN}-{slug}/
        ├── README.md
        ├── EPIC-{ID}-EXECUTION.yaml
        └── stories/            (links para docs/stories/)
```

## Convenção de Épicos

```
epic-{NNN}-{kebab-slug}/
```

- `NNN` — número sequencial (001, 002, ...)
- `slug` — descrição curta em kebab-case

## Ciclo do Épico

1. `@pm *create-epic` → cria pasta + README + EXECUTION.yaml
2. `@sm *draft` → gera stories filhas em `docs/stories/`
3. `@pm *execute-epic` → orquestra execução das stories
4. Encerramento via QA gate final

## Referências

- `.claude/rules/workflow-execution.md` — Spec Pipeline e SDC
- `.aiox-core/development/templates/prd-tmpl.yaml`
- `.aiox-core/development/templates/epic-execution-tmpl.yaml`
