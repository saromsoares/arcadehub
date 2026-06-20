# Architecture

Documentação arquitetural da Arcade Hub mantida por `@architect` (Aria).

## Estrutura

```
architecture/
├── README.md                       (este arquivo)
├── system-architecture.md          (visão geral — bounded contexts, fluxos)
├── tech-stack.md                   (stack canônico do ecossistema)
├── data-architecture.md            (modelo de dados consolidado)
├── adrs/                           (Architectural Decision Records)
│   └── ADR-{NNN}-{slug}.md
└── shards/                         (architecture fragmentada por subdomínio)
```

## ADRs (Architectural Decision Records)

Cada decisão arquitetural relevante deve gerar um ADR seguindo o formato:

```
ADR-{NNN}-{slug}.md
```

Template:

```markdown
# ADR-NNN: {Título}

**Status:** Proposed | Accepted | Deprecated | Superseded
**Data:** YYYY-MM-DD
**Decisores:** @architect, ...

## Contexto
## Decisão
## Consequências
## Alternativas Consideradas
```

## Convenções da Arcade Hub

- **Frontend público** (`/index.html`): single-page HTML+CSS+JS vanilla, sem framework
- **Admin** (`/admin/index.html`): SPA vanilla com Supabase JS SDK + Chart.js
- **Backend**: Supabase (Postgres + Auth + RLS) — projeto `zdwgwpvlwqtsdgervcof`
- **Migrations**: `/supabase/migrations/`
- **Subsidiárias**: empresas filhas + Arcade Hub (holding)

## Referências

- Constitution: `.aiox-core/constitution.md`
- Workflows: `.claude/rules/workflow-execution.md`
