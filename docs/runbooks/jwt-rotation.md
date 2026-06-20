# Runbook: Rotação de JWT anon — Arcade Hub Admin

**Severidade:** CRÍTICA
**Criado em:** 2026-05-22
**Owner:** @devops (Gage)
**Estimativa:** 30 min

## Contexto

O JWT `anon` exposto em `admin/index.html:918` tem **validade até 2088** (63 anos).
Qualquer pessoa que abrir o admin clona a credencial e mantém acesso permanente.

JWT atual (resumo):
```
iss:  supabase
ref:  zdwgwpvlwqtsdgervcof
role: anon
iat:  1772820974  (2026-03-04)
exp:  2088396974  (2036... → na verdade 2036, mas com TTL típico de 10 anos)
```

> **Importante:** mesmo após gerar nova chave, RLS precisa estar habilitado
> (migration `20260522_000001_enable_rls_baseline.sql`) — caso contrário,
> a nova `anon key` ainda exporia todos os dados.

## Pré-requisitos

- [ ] Migration RLS aplicada (`supabase/migrations/20260522_000001_enable_rls_baseline.sql`)
- [ ] Pelo menos 1 usuário inserido em `usuarios_empresas` com role `owner`/`admin` para evitar lockout
- [ ] Backup do `admin/index.html` (controle via git)
- [ ] Acesso ao Supabase Dashboard como owner do projeto

## Procedimento

### Passo 1 — Inserir usuários em `usuarios_empresas`

No SQL Editor do Supabase:

```sql
-- Substitua os UUIDs reais (puxe de auth.users)
insert into public.usuarios_empresas (user_id, empresa_id, role) values
  ('UUID_DO_USER_SAROM', 'arcade_hub', 'owner'),
  ('UUID_DO_USER_SAROM', 'peptiboard', 'owner'),
  ('UUID_DO_USER_SAROM', 'gironamaxima', 'owner'),
  ('UUID_DO_USER_SAROM', 'priva_br', 'owner'),
  ('UUID_DO_USER_SAROM', 'coben_life_os', 'owner'),
  ('UUID_DO_USER_SAROM', 'liquida_pecas', 'owner')
on conflict (user_id, empresa_id) do nothing;
```

Para obter UUIDs:
```sql
select id, email from auth.users where email in ('sarom@asxstore.com', ...);
```

### Passo 2 — Validar policies funcionando

```sql
-- Como usuário autenticado, isto deve retornar só dados das empresas do user:
set local role authenticated;
set local request.jwt.claim.sub = 'UUID_DO_USER_SAROM';
select empresa_id, count(*) from public.lancamentos group by empresa_id;
reset role;
```

### Passo 3 — Rotacionar a chave anon

1. Acesse **Settings → API** no Supabase Dashboard
2. Em **JWT Settings**, clique em **Generate new JWT secret**
3. Confirme — isso **invalida o JWT antigo** e gera um novo `anon` e `service_role`
4. Copie a **nova `anon` key**

### Passo 4 — Atualizar `admin/index.html`

Edite `admin/index.html` linha 918:

```javascript
const SUPABASE_KEY = '<NOVA_ANON_KEY_AQUI>';
```

Commit:
```bash
git add admin/index.html
git commit -m "fix(admin): rotacionar JWT anon Supabase [security]"
```

### Passo 5 — Validar no browser

1. Abra `admin/index.html` em janela anônima
2. Faça login
3. Confirme que dados aparecem normalmente
4. Abra DevTools → Application → Local Storage e verifique sessão Supabase válida

### Passo 6 — Revogar sessões antigas (opcional)

```sql
-- Força todos os usuários a re-logar (sessões antigas invalidadas)
delete from auth.sessions;
delete from auth.refresh_tokens;
```

## Rollback

Se algo der errado, reverta o commit do `admin/index.html`. A chave antiga **não voltará a funcionar** após rotação — você precisará gerar uma nova rotação ou usar uma chave histórica se disponível.

## Pós-Procedimento

- [ ] Smoke test: login, ver KPIs, lançamento mensal
- [ ] Confirmar policies via `select * from pg_policies where schemaname='public'`
- [ ] Documentar nova `anon key` em gerenciador de segredos (1Password, etc.)
- [ ] Atualizar `.env.example` se a key estiver lá
- [ ] Notificar usuários (re-login obrigatório)

## Referências

- [Supabase: Rotating JWT Secret](https://supabase.com/docs/guides/database/managing-jwt-secret)
- `supabase/migrations/20260522_000001_enable_rls_baseline.sql`
- Constitution Artigo V — Quality First
