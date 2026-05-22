# Supabase Migrations

Migrations versionadas para o projeto Supabase `zdwgwpvlwqtsdgervcof`.

## Convenção de Nome

```
YYYYMMDD_HHMMSS_<slug>.sql
```

Cada migration deve ser **idempotente** (pode rodar 2x sem quebrar).

## Como Aplicar

### Opção A — Supabase Dashboard (rápida, manual)

1. Acesse https://supabase.com/dashboard/project/zdwgwpvlwqtsdgervcof
2. Vá em **SQL Editor**
3. Cole o conteúdo do `.sql` e execute
4. Confirme no **Database → Tables/Policies** que as RLS apareceram

### Opção B — Supabase CLI (recomendado a partir do próximo deploy)

```bash
supabase login
supabase link --project-ref zdwgwpvlwqtsdgervcof
supabase db push
```

### Opção C — MCP Supabase (Claude Code)

Via tool `mcp__claude_ai_Supabase__apply_migration`. Requer permissão explícita.

## Migrations Aplicadas

| Arquivo | Data | Descrição | Status |
|---------|------|-----------|--------|
| `20260522_000001_enable_rls_baseline.sql` | 2026-05-22 | RLS baseline + tabela `usuarios_empresas` + função `user_has_empresa_access` | ⏳ Pendente aplicação |

## Referências

- `docs/runbooks/jwt-rotation.md` — runbook para rotação JWT anon
- `docs/architecture/data-architecture.md` — modelo consolidado (criar)
