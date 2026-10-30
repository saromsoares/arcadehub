# Arcade Hub — contexto atual do projeto

Atualizado em **2026-10-30** a partir do código, das stories e das verificações registradas. Este é o ponto de entrada versionado para retomar o trabalho. Estados externos abaixo são observações datadas, não monitoramento contínuo. Não armazenar senhas, tokens ou conteúdo de mensagens nesta documentação.

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
| De Olho.ai | — | Público: https://deolho.ai/; substitui Giro na Máxima |
| Giro na Máxima | `gironamaxima` | Somente admin; cadastro financeiro preservado |
| PrivaBR | `priva_br` | Público e admin |
| Coben Life OS | `coben_life_os` | Público e admin |
| Kanbia | `kanbia` | Público e admin |
| ClickDrop | — | Público: https://clickdrop.app/; substitui Croqui.ai |
| Croqui.ai | `croqui_ai` | Somente admin; cadastro financeiro preservado |
| Jogadaça.ai | `jogadaca` | Público e admin |
| Líquida Peças | `liquida_pecas` | Somente admin |
| Xepou | `xepou` | Somente admin |

São **seis empresas no site público e holding + oito filhas no admin**. A [story 1.5](stories/1.5.story.md) atualiza somente o portfólio público: De Olho.ai apresenta conteúdo sobre tecnologia e IA; ClickDrop apresenta conversão e organização de arquivos, com status Em beta conforme seu site oficial. Os IDs e cadastros financeiros de Giro na Máxima e Croqui.ai permanecem no admin; esta alteração não migra dados nem cadastra novas empresas financeiras. PeptiBoard e CriativoPronto foram removidas do portfólio; não restaurar a partir de memórias antigas. URLs vêm dos cards públicos e de `COMPANIES[].website`. Caixas CBAI/ConfereCheck não implicam inclusão de novas empresas nesses arrays.

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
| [Story 1.5 — portfólio público](stories/1.5.story.md) | Código `3a01a4c` publicado em produção Vercel READY; conteúdo público HTTP 200 confirmado. In Progress pela validação visual interativa pendente. |

Story 1.3: **30 testes backend, 27 verificações Chrome e 14 verificações remotas negativas aprovados**. Nenhum e-mail externo foi enviado nos testes. SMTP autenticado não comprova entrega a destinatário; agrupamento em clientes externos não foi testado. [Parecer QA](qa/reviews/1.3-email-envio.md).

Story 1.5: em 2026-10-30, De Olho.ai e ClickDrop substituíram Giro na Máxima e Croqui.ai somente na home pública. O commit `3a01a4c6e9f48794ccbebe8bb433f7ec32414a0a` foi confirmado em produção READY (`dpl_B8yDadGmm7sr47NSQMKV7tJ9eYnU`). GET de `https://arcadehub.tech/` retornou HTTP 200 com seis cards, os novos domínios e HTML correspondente ao checkout. Treze verificações diretas passaram; CSS, JavaScript e os outros quatro cards permaneceram iguais. Browser host/Computer Use indisponíveis impediram validação visual desktop/mobile e console; QA estático registrou CONCERNS sem defeito concreto bloqueante. A story permanece In Progress por essa validação pendente; admin e dados financeiros não foram alterados.

Artefatos locais ignorados: `.aiox/email-multicaixas-results.json`, `.aiox/email-reply-mobile.png`, `.aiox/email-reply-remote-results.json`, `.aiox/email-final-inventory.json`. Contagens são snapshots datados. O script antigo `.aiox/email-remote-smoke.mjs` contém expectativa de caixas adicionais pendentes: atualizar essa expectativa antes de reutilizar.

## Retomada e operação

1. Ler este documento, a story relevante e `git status`; preservar alterações existentes.
2. Para e-mail, consultar [arquitetura](architecture/email-multicaixas.md), [banco](architecture/email-multicaixas-database.md) e [runbook operacional](runbooks/email-operacao.md).
3. Usar o perfil Supabase isolado já autenticado. Em 2026-10-15, o conector negava o projeto apesar da conta conectada; CLI funcionou. Não confundir erro do conector com ausência de acesso, nem sobrescrever o perfil padrão de outro projeto.
4. Migrações locais não refletem todo o histórico remoto. Não executar `db push` indiscriminadamente. Ver [procedimento e histórico](../supabase/migrations/README.md).
5. Frontend estático publica pelo push em `main` → Vercel, projeto `arcadehub`, team `asxtecnology`; `git push` é exclusivo do @devops. Edge Functions exigem deploy separado. Em mudanças de contrato, publicar backend antes do frontend e confirmar SHA exato READY.

Extensão posterior, [story 1.4](stories/1.4.story.md): assinaturas visuais automáticas e preview implementados para as sete caixas usando seis PNG fornecidos; Arcade e CBAI compartilham a arte autorizada. Deno passou 31/31 com fixtures SMTP/MIME; compara MIME decodificado ao histórico, verifica uma imagem ativa por envio e inclui a resposta Coben. `deno check`, `node --check` e `git diff --check` também passaram. Os comandos npm lint/typecheck/test foram tentados e retornam ENOENT, pois não existe `package.json`. Nenhum e-mail externo foi enviado; validação interativa do dashboard autenticado permanece pendente.

Histórico de publicação: `c8edc14` publicou os cinco assets iniciais; `d0fcf06` integrou backend/frontend e `372ec6d` registrou evidências. `ebcee73` publicou somente coben.png, confirmado por GET anônimo HTTP 200/image/png com hash idêntico. Depois foram republicados somente email-accounts/email-send e o frontend Coben no commit `00fe18ea63d3e3ffa2d2677c8bd5c64edec0e58c`, confirmado Vercel produção READY (`dpl_5x49oieokm3vYN7FxKELQhwtnVuV`). O admin público retornou HTTP 200 com o mapa coben.png. A suíte Deno passou 31/31 com matriz SMTP/MIME das sete caixas e a revisão QA aprovou backend/MIME; não houve alteração de segredo/schema nem envio de e-mail. A story permanece In Progress somente pela validação visual interativa do dashboard autenticado, sem pendência visual de Coben.

Limites atuais: anexos e cadastro de novas caixas não foram implementados nesta entrega. Memórias antigas de JWT/advisors e integrações financeiras não foram revalidadas integralmente aqui; consultar os respectivos runbooks antes de concluir seu estado atual.
