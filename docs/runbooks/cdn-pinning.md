# Runbook: Pinning de CDNs e SRI

**Criado em:** 2026-05-22
**Owner:** @devops (Gage)

## Contexto

Antes da rotina de hardening, o admin carregava dependências CDN sem pin de versão (`@supabase/supabase-js@2`, `chart.js@4`). Isso significa:

- **Supply-chain:** qualquer release com bug ou backdoor entra automaticamente
- **Sem SRI:** impossível garantir integridade do arquivo entregue

## Estado Atual (pós-hardening)

| Dependência | URL Atual | Versão | SRI |
|------------|-----------|--------|-----|
| `@supabase/supabase-js` | `cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/dist/umd/supabase.min.js` | 2.45.0 | ⏳ a calcular |
| `chart.js` | `cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js` | 4.4.0 | ⏳ a calcular |
| `fonts.googleapis.com` (CSS) | Google Fonts CSS API | — | ⏳ (CSS varia por User-Agent, SRI não recomendado) |

## Como Atualizar (rotina trimestral)

### 1. Identificar nova versão LTS

```bash
npm view @supabase/supabase-js version
npm view chart.js version
```

### 2. Gerar SRI hash

```bash
# Supabase JS
curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<VERSION>/dist/umd/supabase.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
# Saída: prefix com sha384-

# Chart.js
curl -s https://cdn.jsdelivr.net/npm/chart.js@<VERSION>/dist/chart.umd.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

### 3. Aplicar no `admin/index.html`

```html
<script src="..." integrity="sha384-<HASH>" crossorigin="anonymous"></script>
```

### 4. Testar smoke flow

- [ ] Login funciona
- [ ] KPIs renderizam (depende do Chart.js)
- [ ] Persistência Supabase funciona
- [ ] Console sem `Failed to find a valid digest`

### 5. Documentar

Atualizar a tabela "Estado Atual" acima.

## Por que SRI não está aplicado já?

Geração de hash exige fetch HTTP do arquivo da CDN. A rotina de hardening atual focou em CSP + version pinning (já reduz drasticamente o risco). Aplicar SRI numa próxima janela com acesso outbound HTTPS.

## Referências

- [MDN: Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
- [CSP3 — `require-sri-for`](https://www.w3.org/TR/CSP3/)
