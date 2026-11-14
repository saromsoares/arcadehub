# Arcade Hub — contexto atual do projeto

Atualizado em **2026-11-14** a partir do código, das stories e das verificações registradas. Este é o ponto de entrada versionado para retomar o trabalho. Estados externos abaixo são observações datadas, não monitoramento contínuo. Não armazenar senhas, tokens ou conteúdo de mensagens nesta documentação.

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
| De Olho.ai | — | Público: https://deolho.ai/; substitui Giro na Máxima no site |
| Giro na Máxima | — | Retirada do admin em 2026-11-10. Histórico permanece no banco sob `gironamaxima` e não volta para `COMPANIES` |
| PrivaBR | `priva_br` | Público e admin |
| Coben Life OS | `coben_life_os` | Público e admin |
| Kanbia | — | Público. Retirada do admin em 2026-11-10. Histórico permanece no banco sob `kanbia` |
| ClickDrop | `clickdrop` | Público e admin: https://clickdrop.app/ |
| Croqui.ai | — | Retirada do admin em 2026-11-10. Histórico permanece no banco sob `croqui_ai` |
| Jogadaça.ai | `jogadaca` | Público e admin |
| Líquida Peças | `liquida_pecas` | Somente admin |
| GiroMob | `giromob` | Público e admin: https://giromob.app/. Não reutilizar o ID antigo `gironamaxima` |
| ConfereCheck | `conferecheck` | Público e admin desde 2026-11-11. Site próprio ainda não publicado; o card fala por `contato@conferecheck.com.br`. O mesmo texto é o ID da caixa de e-mail |
| Xepou | — | Retirada do admin em 2026-11-10. Histórico permanece no banco sob `xepou` |

São **oito empresas no site público e holding + sete filhas no admin**. A [story 1.5](stories/1.5.story.md) atualizou o portfólio público em 2026-10-30: De Olho.ai apresenta conteúdo sobre tecnologia e IA; ClickDrop apresenta conversão e organização de arquivos, com status Em beta conforme seu site oficial. Em 2026-11-10 o admin retirou Giro na Máxima, Kanbia, Xepou e Croqui.ai da lista e passou a cadastrar ClickDrop (`clickdrop`). Em 2026-11-11 entraram GiroMob e ConfereCheck, por pedido explícito. Essa retirada não apaga lançamentos antigos nem migra saldos. PeptiBoard e CriativoPronto foram removidas do portfólio; não restaurar a partir de memórias antigas. URLs vêm dos cards públicos e de `COMPANIES[].website`. A caixa da CBAI não implica uma empresa nova.

## Dashboard e dados

O admin reúne indicadores financeiros, comparativo, a página Financeiro (Mercado Pago, Stripe e Nubank), contatos do site, leads por projeto, e-mails, lançamentos, Orçamento & Caixa, balanço dos sócios, calendário e cadastros. A mudança de 2026-11-10 retirou Giro na Máxima, Kanbia, Xepou e Croqui.ai de `COMPANIES` e incluiu `clickdrop`. Em 2026-11-11 entraram `giromob` e `conferecheck`. Os lançamentos históricos dos IDs retirados permanecem no banco.

Projeto Supabase: **`zdwgwpvlwqtsdgervcof`**, API `https://zdwgwpvlwqtsdgervcof.supabase.co`. Tabelas relevantes incluem `lancamentos`, `planejado`, `custos_extras`, `estrutura`, `calendario_acoes`, `usuarios_empresas`, `usuarios_paginas_bloqueadas`, `mp_recebimentos`, `stripe_recebimentos`, `contatos`, `leads`, `emails` e `email_mailboxes`. A lista não substitui inventário do banco.

`usuarios_paginas_bloqueadas` guarda, por usuário, os ids `mercadopago`, `stripe`, `lancamentos`, `estrutura` e `balanco`. O menu esconde Lançamentos, Orçamento & Caixa e Balanço dos Sócios. Mercado Pago e Stripe ficam dentro de Financeiro, e esses dois ids escondem o card e a tabela de recebimentos. Sem essa linha, o menu segue completo. As tabelas `mp_recebimentos` e `stripe_recebimentos` continuam ilegíveis para quem tem a página bloqueada. O saldo disponível, porém, entra no Caixa Atual: `mp-saldo` e `stripe-saldo` respondem a qualquer usuário da holding, e o Painel soma os dois saldos disponíveis mesmo com essas páginas ocultas. O Painel reúne os indicadores do grupo numa página só. O Caixa Atual dessa página, e o da tela de orçamento, soma o saldo disponível do Mercado Pago ao do Stripe. Se a consulta direta de saldo do Mercado Pago responder 403, `mp-saldo` lê o relatório de liberações e devolve esse número com `origem: relatorio`. Enquanto o arquivo é gerado, a resposta fica `saldo_erro: preparando`. O card soma esse valor ao Stripe e identifica a origem. O valor a liberar da consulta direta continua de fora. O relatório pode divergir do saldo mostrado na tela do Mercado Pago. Comparativo e a página da empresa continuam lendo lançamentos e orçamento; para quem tem Mercado Pago ou Stripe bloqueado, esses recebimentos não entram nos totais. A carga inicial lê as páginas bloqueadas antes do restante e não consulta `mp_recebimentos` nem `stripe_recebimentos` quando a página está bloqueada. O overlay "Carregando Arcade Hub..." fecha ao terminar essa carga e não é religado por um segundo login da mesma sessão.

Em **2026-11-12** o admin em produção recebeu dois commits. `ff64738` mostra centavos em `fmt`, eixos com `fmtEixo`, resultado negativo do Painel em vermelho, menu lateral fora da tela até 700px e as duas colunas empilhadas nessa largura. Os lápis de nome, site, emoji, cor e títulos, que não eram gravados, saíram. `b34e775` identifica no card quando o Mercado Pago veio do relatório de liberações. A função `mp-saldo` foi publicada no Supabase antes desse frontend; o push do Git não publica Edge Function. A consulta direta de saldo segue recusada para o token de Checkout Pro da holding. Webhooks e a jornada de qualidade do Checkout Pro não liberam essa consulta. A conta vendedora mostrada como CB AI SOLUTIONS no painel de desenvolvedor é a holding. O Access Token de produção permanece só no segredo `MP_ACCESS_TOKEN`.

O saldo da conta Nu Empresas aparece no Painel, num card próprio que não entra no Caixa Atual, na página Financeiro, no mesmo lugar do Mercado Pago e da Stripe, e continua na página Dados. Em Financeiro também ficam agência, conta e banco do Nu Empresas. A função é `nubank-saldo`, que lê o Meu Pluggy. A atualização da Pluggy pode levar até 24 horas. Esse número fica fora do Caixa Atual e do runway. Os ids `mercadopago` e `stripe` não têm mais botão próprio: dentro de Financeiro eles escondem o card e os recebimentos de quem tem a página bloqueada. As chaves ficam só nos segredos `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e `PLUGGY_ITEM_ID`. O push do Git não publica essa função.

O módulo de e-mail exige vínculo à holding via `user_has_empresa_access('arcade_hub')`. Ter apenas vínculo a uma filha não concede acesso às caixas. O frontend usa chave publishable; credenciais SMTP/IMAP e chaves privilegiadas ficam no servidor.

### Stripe ClickDrop — extensão em 2026-11-14

A [story 1.6](stories/1.6.story.md) adiciona a conta própria do ClickDrop sem substituir a ARCADE HUB TECH. A holding mantém `STRIPE_SECRET_KEY`; a nova conta usa `STRIPE_CLICKDROP_SECRET_KEY` e `STRIPE_CLICKDROP_ACCOUNT_ID`, só no servidor. Atribuição inicial automática para `clickdrop`, origem em `raw`, reexecução preservando vínculos manuais, saldo BRL por conta e aviso de leitura parcial. A receita usa os agregadores atuais; não duplicar em `lancamentos`. O Realtime atualiza Painel/Comparativo e empresa aberta; Atualizar relê recebimentos. [Runbook](runbooks/stripe-contas.md).

Backend `stripe-sync`/`stripe-saldo` publicado antes do frontend; código `e2ac35e` em produção Vercel READY (`dpl_DfMM5fLKj2LtcQvwFCfNUUamxwS6`), admin HTTP 200 e hash idêntico ao Git. Conexão da conta ClickDrop ainda pendente neste registro: o usuário está cadastrando a credencial em terminal local. Deno 27/27, lógica do dashboard com DOM/SDK simulados, check e diff aprovados. Verificações remotas antes e depois do deploy: 23 checks em cada fase, incluindo semântica real de upsert preservando vínculos, autorização e RLS. A nova sincronização da holding retornou HTTP 200 e preservou seus 11 recebimentos. Evidências locais `.aiox/stripe-clickdrop-publication.json`, `.aiox/stripe-remote-before.json` e `.aiox/stripe-remote-after.json`.

O saldo geral que o usuário apontou como incorreto foi conferido: holding **−R$ 0,28 disponível / R$ 18,86 a liberar / R$ 18,58 total**, idêntico ao endpoint e screenshot. O extrato completo reconcilia o negativo com duas tarifas Billing de R$ 0,14; evidência `.aiox/stripe-holding-reconciliation.json`. O screenshot ClickDrop informa R$ 99,90 bruto / R$ 95,52 de saldo; não declarar venda importada antes de validar a API. Acesso Computer Use encerrado por URL não verificável; desktop/mobile/console autenticados continuam pendentes.

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
