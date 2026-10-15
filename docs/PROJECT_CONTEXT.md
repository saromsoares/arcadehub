# Arcade Hub — contexto atual do projeto

Atualizado em **2026-10-15** a partir do código, das stories e das verificações desta sessão. Este é o ponto de entrada versionado para retomar o trabalho. Estados externos abaixo são observações datadas, não monitoramento contínuo. Não armazenar senhas, tokens ou conteúdo de mensagens nesta documentação.

## Produto e código

Holding de tecnologia brasileira com site institucional e dashboard financeiro/operacional autenticado. Produção: [site](https://arcadehub.tech/) e [admin](https://arcadehub.tech/admin/). Repositório público `saromsoares/arcadehub`, branch `main`.

- `index.html`: HTML/CSS/JS inline, identidade **ARCADE CORE**, núcleo com órbitas e conexões em HTML/SVG/CSS. Não usa Three.js, WebGL ou build. Cards semânticos `[data-company]` alimentam `PORTFOLIO`, seleção de empresa e formulário de contato. Preserva teclado, modal acessível, rolagem e reduced motion.
- `admin/index.html`: SPA vanilla, Supabase Auth, SDK Supabase JS 2.45.0 e Chart.js 4.4.0 via CDN fixado. `COMPANIES` define empresas financeiras; `email-accounts` define caixas de e-mail. São cadastros diferentes.
- `assets/brand/`: artes oficiais e derivados WebP usados como máscaras na home. Assets de login/sidebar, favicon e Open Graph também ficam na raiz.
- `supabase/functions/`: cinco funções de e-mail e helpers; SDK servidor 2.117.0, denomailer 1.6.0 e lockfile Deno. Outras integrações remotas já existentes não têm necessariamente código neste checkout.
- `supabase/migrations/`, `supabase/operations/`, `supabase/tests/`, `scripts/` e `docs/` também são versionados. AIOX, `.aiox/`, `.claude/`, `.codex/` e `AGENTS.md` são locais e ignorados.

O site não tem gates genéricos npm de build/lint/test. Mudanças de interface exigem navegador desktop/mobile e console; alterações nas funções exigem testes Deno apropriados. Documentação é validada por conteúdo, referências e diff.

## Empresas atuais

| Empresa | ID no admin | Exposição |
| --- | --- | --- |
| Arcade Hub | `arcade_hub` | Holding no admin |
| Giro na Máxima | `gironamaxima` | Público e admin |
| PrivaBR | `priva_br` | Público e admin |
| Coben Life OS | `coben_life_os` | Público e admin |
| Kanbia | `kanbia` | Público e admin |
| Croqui.ai | `croqui_ai` | Público e admin |
| Jogadaça.ai | `jogadaca` | Público e admin |
| Líquida Peças | `liquida_pecas` | Somente admin |
| Xepou | `xepou` | Somente admin |

São **seis empresas no site público e holding + oito filhas no admin**. PeptiBoard e CriativoPronto foram removidas do portfólio; não restaurar a partir de memórias antigas. URLs vêm dos cards públicos e de `COMPANIES[].website`. Caixas CBAI/ConfereCheck não implicam inclusão de novas empresas nesses arrays.

## Dashboard e dados

O admin reúne indicadores financeiros, comparativo, Mercado Pago, contatos do site, e-mails, lançamentos, Orçamento & Caixa, balanço dos sócios, calendário e cadastros. Manter os fluxos financeiros existentes; esta entrega de e-mail não os alterou.

Projeto Supabase: **`zdwgwpvlwqtsdgervcof`**, API `https://zdwgwpvlwqtsdgervcof.supabase.co`. Tabelas relevantes incluem `lancamentos`, `planejado`, `custos_extras`, `estrutura`, `calendario_acoes`, `usuarios_empresas`, `mp_recebimentos`, `contatos`, `emails` e `email_mailboxes`. A lista não substitui inventário do banco.

O módulo de e-mail exige vínculo à holding via `user_has_empresa_access('arcade_hub')`. Ter apenas vínculo a uma filha não concede acesso às caixas. O frontend usa chave publishable; credenciais SMTP/IMAP e chaves privilegiadas ficam no servidor.

## Sete caixas conectadas

| `mailbox_id` | Endereço |
| --- | --- |
| `arcade_hub` | `suporte@arcadehub.tech` |
| `cbai_solutions` | `suporte@cbaisolutions.com.br` |
| `jogadaca` | `contato@jogadaca.ai` |
| `coben` | `contato@coben.app` |
| `privabr` | `suporte@privabr.com.br` |
| `liquida_pecas` | `contato@liquidapecas.com.br` |
| `conferecheck` | `contato@conferecheck.com.br` |

As sete foram autenticadas em IMAP/SMTP e sincronizadas em 2026-10-15. Discovery confirmou `can_send=true` e `can_sync=true`; senhas das seis adicionais foram digitadas pelo usuário em terminal local com entrada oculta. O legado manteve sua configuração existente. Não solicitar recadastro se a conexão vigente funciona.

No dashboard, selecionar a caixa e usar **Novo e-mail**, **Responder** ou **Cancelar**. O remetente é fixado pela caixa autorizada. Recebidos, enviados, leitura, exclusão, sincronização e realtime respeitam `mailbox_id`. Erros preservam rascunhos; troca de caixa ou descarte exige confirmação; envio em andamento bloqueia substituição e duplicação do pedido.

`email-send` recebe `{ mailbox_id, to, cc, subject, text, reply_to_id? }`. Respostas exigem original autorizado na mesma caixa e `direcao=in`. O servidor produz `Message-ID` novo, persistido antes do SMTP, e `In-Reply-To`/`References` do original seguro. Sem identificador original válido, envia sem encadeamento e mostra aviso. `References` contém só o pai imediato; não há coluna nova de vínculo ou reconstrução de ancestrais. Não reenviar automaticamente quando SMTP tiver resultado incerto.

IMAP TLS 993 e SMTP TLS 465 na Hostinger. Sync busca cabeçalhos recentes (limite padrão 60), e corpo é carregado sob demanda e exibido com HTML em iframe sandbox. O histórico local não representa necessariamente toda a caixa remota. Identidade IMAP inclui caixa + pasta/UID + UIDVALIDITY.

Cinco funções publicadas: `email-accounts`, `email-check`, `email-sync`, `email-body`, `email-send`. Todas usam `verify_jwt=false` no gateway e autenticam e autorizam internamente; isso **não significa endpoint público sem controle**. Somente sync aceita autenticação de máquina dedicada. Job `email-sync-incremental` (3) roda a cada três minutos com token no Vault, filtra caixas habilitadas/verificadas e foi confirmado ativo.

## Entregas e evidências

| Entrega | Estado registrado |
| --- | --- |
| [Story 1.1 — ARCADE CORE](stories/1.1.story.md) | Código presente em produção; documento ainda `Ready for Review`, sem parecer QA preenchido. Não declarar esse gate concluído. |
| [Story 1.2 — multicaixas](stories/1.2.story.md) | Done; migração `20261015182925` aplicada e registrada; sete caixas verificadas e sincronizadas. |
| [Story 1.3 — envio e resposta](stories/1.3.story.md) | Done; código `1358930`, fechamento `d5ca892`, produção Vercel READY e admin HTTP 200. |

Story 1.3: **30 testes backend, 27 verificações Chrome e 14 verificações remotas negativas aprovados**. Nenhum e-mail externo foi enviado nos testes. SMTP autenticado não comprova entrega a destinatário; agrupamento em clientes externos não foi testado. [Parecer QA](qa/reviews/1.3-email-envio.md).

Artefatos locais ignorados: `.aiox/email-multicaixas-results.json`, `.aiox/email-reply-mobile.png`, `.aiox/email-reply-remote-results.json`, `.aiox/email-final-inventory.json`. Contagens são snapshots datados. O script antigo `.aiox/email-remote-smoke.mjs` contém expectativa de caixas adicionais pendentes: atualizar essa expectativa antes de reutilizar.

## Retomada e operação

1. Ler este documento, a story relevante e `git status`; preservar alterações existentes.
2. Para e-mail, consultar [arquitetura](architecture/email-multicaixas.md), [banco](architecture/email-multicaixas-database.md) e [runbook operacional](runbooks/email-operacao.md).
3. Usar o perfil Supabase isolado já autenticado. Em 2026-10-15, o conector negava o projeto apesar da conta conectada; CLI funcionou. Não confundir erro do conector com ausência de acesso, nem sobrescrever o perfil padrão de outro projeto.
4. Migrações locais não refletem todo o histórico remoto. Não executar `db push` indiscriminadamente. Ver [procedimento e histórico](../supabase/migrations/README.md).
5. Frontend estático publica pelo push em `main` → Vercel, projeto `arcadehub`, team `asxtecnology`; `git push` é exclusivo do @devops. Edge Functions exigem deploy separado. Em mudanças de contrato, publicar backend antes do frontend e confirmar SHA exato READY.

Extensão posterior, [story 1.4](stories/1.4.story.md): assinaturas visuais automáticas e preview implementados para seis caixas usando cinco PNG fornecidos; Arcade e CBAI compartilham a arte autorizada. Coben continua sem arte, com identificação textual. Assets públicos verificados antes do backend/frontend; nenhum teste novo ou envio externo nesta rodada, por instrução. A definição visual de Coben mantém a story em andamento.

Limites atuais: anexos e cadastro de novas caixas não foram implementados nesta entrega. Memórias antigas de JWT/advisors e integrações financeiras não foram revalidadas integralmente aqui; consultar os respectivos runbooks antes de concluir seu estado atual.
