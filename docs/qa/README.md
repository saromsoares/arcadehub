# Quality Assurance

Quality gates e reviews produzidos por `@qa` (Quinn).

## Pareceres existentes

- [Story 1.2 — multicaixas](reviews/1.2-email-multicaixas.md).
- [Story 1.3 — envio e resposta](reviews/1.3-email-envio.md): PASS local, 30 testes backend e 27 verificações Chrome; a story registra também 14 checks remotos negativos e publicação.

Nenhum e-mail real foi enviado nos testes. Não há parecer preenchido para a story 1.1. A estrutura abaixo é uma convenção; consultar arquivos existentes, sem presumir que todo gate YAML já foi criado.

## Estrutura

```
qa/
├── README.md
├── gates/                          (decisões de gate por story)
│   └── {epicNum}.{storyNum}-{slug}.yml
└── reviews/                        (reviews QA detalhadas)
    └── {epicNum}.{storyNum}.md
```

## Gate Decisions

Cada gate produz uma decisão estruturada:

```yaml
story: 1.2
title: "..."
status: PASS | CONCERNS | FAIL | WAIVED
decided_by: '@qa Quinn'
decided_at: 'YYYY-MM-DDTHH:MM:SSZ'
checks:
  acceptance_criteria: PASS|FAIL
  test_coverage: PASS|FAIL
  security_review: PASS|FAIL
  performance: PASS|FAIL
  accessibility: PASS|FAIL
  code_quality: PASS|FAIL
  documentation: PASS|FAIL
findings:
  - id: F1
    severity: critical|high|medium|low
    description: '...'
    location: 'file.ext:line'
```

## Referências

- `.claude/rules/story-lifecycle.md`
- `.claude/rules/workflow-execution.md` — Phase 4 QA Gate
