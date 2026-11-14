# Stripe — holding e ClickDrop

A integração mantém `STRIPE_SECRET_KEY` da ARCADE HUB TECH (`acct_1Te0GtHMBfCrtXpm`). A conta independente ClickDrop usa `STRIPE_CLICKDROP_SECRET_KEY` e `STRIPE_CLICKDROP_ACCOUNT_ID`. Não substituir a chave da holding pela do ClickDrop. Não é uma integração Stripe Connect.

## Conectar o ClickDrop

1. Na conta **ClickDrop**, criar uma chave restrita **de produção**, somente leitura de conta, saldo, cobranças e transações de saldo. A expansão `data.balance_transaction` precisa dessa última permissão para obter taxa e líquido. Chave publicável não autoriza consultas do servidor. [Referência Stripe](https://docs.stripe.com/keys).
2. No Windows, executar `powershell.exe -STA -NoProfile -File ./scripts/salvar-chave-stripe-clickdrop.ps1` para abrir uma janela com campo de senha e botão **Validar e salvar no Supabase**. A alternativa CLI é `./scripts/configurar-stripe-clickdrop.ps1`, aguardando o prompt de entrada oculta: nunca colar a chave no prompt de comandos `PS ...>`. O ID esperado padrão veio da URL do screenshot do usuário: `acct_1Ub1arEtZs5VZmDQ`. Antes de salvar, o script compara esse ID com `/v1/account`, verifica saldo/cobranças reais e as permissões. Se o ID do screenshot estiver incorreto, conferir a URL da conta e passar `-AccountId acct_...` no CLI; nunca usar o ID da holding nesse parâmetro.
3. Colar a chave apenas no campo de senha da janela ou na entrada oculta do CLI. A janela passa um `SecureString` em memória ao helper, sem chave em argumentos. O script envia somente os dois segredos ClickDrop ao Supabase `zdwgwpvlwqtsdgervcof`, pelo perfil CLI isolado. O arquivo temporário tem ACL exclusiva do usuário e é removido no `finally`. O status local `.aiox/stripe-clickdrop-setup.json` não contém chave; falhas da janela geram somente uma mensagem sanitizada em `.aiox/stripe-clickdrop-setup-error.json`. A chave não entra em HTML, Git ou conversa.
4. Publicar `stripe-sync` e `stripe-saldo` pelo CLI 2.121.0 isolado, seguindo o procedimento de perfil em [e-mail/operação](email-operacao.md). Publicar backend antes do frontend; Git push não publica Edge Functions. Não executar `db push`: esta extensão não altera schema/RLS.
5. O cron `stripe-sync-incremental`, a cada dois minutos, continua usando seu token dedicado. Confirmar a resposta HTTP e os resultados por conta; `cron.job_run_details.status=succeeded` comprova o disparo, não o sucesso HTTP da função.
6. Conferir a cobrança real importada, sua origem `raw.account_source=clickdrop`, `raw.account_id`, `empresa_id`, status, bruto, taxa e líquido. Confirmar também que a holding continua sincronizando e seus vínculos não mudaram.

Os segredos ficam disponíveis às Edge Functions pelo ambiente do servidor. [Referência Supabase](https://supabase.com/docs/guides/functions/secrets).

## Comportamento

- Cada conta tem limite e cursor próprios. A identidade esperada é conferida antes de ler os dados. Chaves/valores de teste, slot ClickDrop com identidade da holding e origens conflitantes são recusados.
- Recebimentos novos da conta ClickDrop recebem `empresa_id=clickdrop` no INSERT com conflito ignorado. A atualização financeira posterior omite `empresa_id`; reexecução preserva atribuições manuais, inclusive `null`, e não cria outro lançamento em `lancamentos`.
- A tabela Financeiro mostra a conta de origem e bruto/taxa/líquido. Painel, Comparativo e empresa aberta são atualizados pelo Realtime; Atualizar relê também os recebimentos. A origem não muda quando o usuário altera o vínculo financeiro.
- `stripe-saldo` agrega somente BRL, devolve `contas` e mantém `saldo.disponivel`, `saldo.a_liberar`, `saldo.total`. Disponível integra Caixa Atual; pendente fica de fora. Falha de uma conta não impede a outra: a soma conhecida vem com `parcial=true`, identificada no Financeiro e no Caixa. Falha de ambas retorna erro, não saldo zero fictício.
- Acesso continua exigindo holding. Bloqueio de página `stripe` esconde detalhes e mantém RLS nos recebimentos; o saldo agregado permitido no Caixa continua disponível ao usuário da holding. Não alterar permissões do suporte.

## Evidência em 2026-11-14

Antes da extensão, a API da holding e o endpoint publicado concordaram: disponível **−R$ 0,28**, a liberar **R$ 18,86**, total **R$ 18,58**. O screenshot do Financeiro do usuário mostrou os mesmos valores. O extrato completo da conta reconciliou o disponível; duas tarifas `Billing - Usage Fee` de R$ 0,14 (25/10 e 10/11) explicam os R$ 0,28 negativos. Não corrigir esse valor real para zero nem somar pendentes ao disponível.

O screenshot ClickDrop informou R$ 99,90 brutos e R$ 95,52 de saldo, com repasse esperado para 14/12. Após o cadastro seguro, a API confirmou a conta `acct_1Ub1arEtZs5VZmDQ` e a cobrança aprovada `ch_3UbhcHEtZs5VZmDQ0yh0zPAK`: R$ 99,90 bruto, R$ 4,38 taxa, R$ 95,52 líquido, importada como `clickdrop`. A conta nova tem R$ 0 disponível e R$ 95,52 a liberar. As duas contas somam −R$ 0,28 disponível, R$ 114,38 a liberar e R$ 114,10 total. Sync repetido HTTP 200 manteve 11 recibos da holding e 1 ClickDrop, sem duplicação. Dados reais executados pelos agregadores do JS confirmaram receita novembro/YTD de R$ 99,90 e site correto `https://clickdrop.app/` (HTTP 200); sem duplicação em lançamento manual. Evidências sanitizadas `.aiox/stripe-remote-clickdrop.json` e `.aiox/stripe-live-verification.json`.

Validação local: 27 testes Deno (HTTP/Auth/PostgREST em memória, sem rede), `deno check`, verificação da lógica do dashboard com DOM/SDK simulados e `git diff --check`. Verificações remotas antes/depois do deploy e após configurar a conta real: 23 checks em cada fase, incluindo atribuições manuais preservadas no PostgREST real, saldo autenticado, negações de acesso e RLS do bloqueio Stripe. Fixtures remotas temporárias foram removidas; não houve alteração de pagamentos no Stripe. O cadastro foi concluído pela janela local na sessão interativa do usuário; o registro de tarefa temporário foi removido após o sucesso.

Estado de conexão, publicação e pendências visuais: [story 1.6](../stories/1.6.story.md) e [parecer QA](../qa/reviews/1.6-stripe-clickdrop.md). Computer Use interrompeu o acesso por não conseguir validar a URL atual no Windows; não atribuir aprovação a navegador desktop/mobile/console autenticados.

## Reversão

O backup local anterior está em `.aiox/stripe-before-20261114/`. Se necessário, republicar somente os handlers/helpers anteriores e reverter o frontend pelo fluxo @devops. Manter os recebimentos já importados e a credencial da holding. Não apagar histórico, não reaplicar migrações e não reclassificar recibos manualmente para esconder falha de integração.
