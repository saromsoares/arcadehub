# Quality Assurance

Quality gates e reviews produzidos por `@qa` (Quinn).

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
