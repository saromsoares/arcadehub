# Dashboard — segurança, financeiro e operação

Implementação das stories [1.7](../stories/1.7.story.md), [1.8](../stories/1.8.story.md) e [1.9](../stories/1.9.story.md), autorizada em 14/11/2026. Arquitetura e contratos em [dashboard-evolution](../architecture/dashboard-evolution.md).

## Uso

- **Painel:** pendências apontam para a página de revisão. Ausência de metas, falha de leitura, recebimento sem classificação e resultado provisório aparecem explicitamente. Alertas dependem dos dados carregados e das permissões atuais.
- **Financeiro:** disponível, valores a liberar, data da consulta e referência da fonte têm significados diferentes. O Caixa Atual soma somente disponível MP + Stripe; Nu Empresas fica separado. Uma leitura anterior pode ser preservada com aviso de desatualização. Movimentos Stripe têm limite de 100 por conta e cobertura parcial; não são novas receitas.
- **Conciliação:** atribuir recebimento a projeto ou aporte exige revisão. A venda ClickDrop permanece no recebimento original, sem lançamento manual duplicado. Taxa manual só compensa a taxa automática se vinculada ao mesmo recebimento, projeto, mês e valor. Estornos não presumem devolução de taxa; o efeito ainda não confirmado fica pendente.
- **Lançamentos e empresas:** receita manual e de gateways compõem o bruto uma vez; custos incluem itens, legado e taxas conhecidas. Líquido ausente permanece desconhecido. Moedas diferentes ficam separadas. Um erro de gravação mantém o rascunho e não confirma um lançamento inexistente.
- **Comparativo:** o acumulado usa ano e meses transcorridos da janela operacional. Metas anuais continuam visíveis; registros futuros ficam fora do acumulado. Variação favorável do resultado é realizado menos meta, inclusive quando a meta é negativa.
- **Orçamento & Caixa:** cenários usam disponível e consumo dos últimos até três meses fechados, sem presumir receita futura. Liberação de cobrança não garante repasse bancário. Cenários não alteram lançamentos.
- **Leads e contatos:** registrar responsável, próxima ação e prazo. A conversão de contato pede revisão do projeto e evita duplicar a conversão na repetição. Histórico novo começa a partir da implantação; eventos antigos não são inventados.
- **Calendário:** filtro de sete dias inclui hoje e os seis dias seguintes. Projeto é opcional e explícito; ações antigas permanecem sem projeto vinculado. A remoção atua sobre a ação identificada. Em custos recorrentes, a remoção de item e de série são escolhas distintas.
- **E-mail:** busca e paginação cobrem o histórico local carregado, com limite informado. Rascunhos ficam na sessão da aba, separados por usuário e caixa; sua recuperação é manual. Encerrar a sessão remove esses rascunhos. “Sem resposta registrada” só usa vínculo de resposta persistido e não prova ausência de atendimento em outro canal. Nenhum rascunho é enviado automaticamente.
- **Sócios:** registrar reembolso significa registrar uma quitação já feita, com referência. Não transfere dinheiro. Reduz a obrigação pessoal elegível; não cria outra despesa nem aporte. Uma baixa pode ser cancelada com histórico.
- **Acessos:** metadados são separados do segredo no servidor. Revelar/copiar exige autenticação, holding e senha mestra. Auditoria registra ação e autor, sem armazenar o segredo no evento. Revisão de cadastro não significa alteração automática da senha.

## Publicação e verificação

1. Preservar snapshots das funções e metadados/grants/contagens antes da migração; nunca exportar senhas para evidência.
2. Confirmar antes do deploy que `ACESSOS_MASTER_HASH` está configurado como segredo do servidor, preservando a senha vigente sem publicar o hash. Publicar `acesso-senha` com compatibilidade temporária `ACESSOS_LEGACY_COMPAT=true`, mantendo autenticação, holding e senha mestra no caminho legado.
3. Aplicar individualmente `20261114184422_stripe_history_coverage.sql` e `20261114184425_dashboard_secure_operations.sql`. A cópia das credenciais é verificada dentro do banco antes de remover a cópia pública. Não usar `db push` devido ao histórico divergente.
4. Registrar somente essas versões no histórico remoto e publicar `acessos-manage`, `dashboard-ops`, `email-send`, `stripe-sync`, `stripe-saldo`, `mp-saldo` e `nubank-saldo`. Remover a flag de compatibilidade após validar o RPC privado.
5. Aplicar a operação `supabase/operations/stripe-history-cron.sql`. A varredura histórica tem cursor, lease e checkpoints por conta; não marca rodada completa enquanto houver próxima página.
   A migration adicional `20261114191002_dashboard_legacy_function_grants.sql` restringe a rotina mensal legada `rollforward_custos_fixos` ao servidor/owner do cron e fixa o search_path dos dois helpers MP, preservando sua lógica e agenda. Aplicar e registrar somente essa versão, sem executar a rotina para testar em produção.
6. Validar RLS, grants, autenticação, idempotência, saldos, conta Nu e preservação dos recebimentos. Fixtures remotas de negócio devem ser transacionais com rollback ou ter limpeza comprovada. Não enviar e-mail, criar cobrança ou executar pagamento para testar.
7. Publicar frontend por @devops, confirmar Vercel READY no SHA exato e HTTP/hash dos arquivos externos. Validar desktop/mobile/console quando o navegador estiver disponível; VM/API não substituem validação visual.

Testes locais: `node --test scripts/test-dashboard-finance.mjs scripts/test-dashboard-finance-review.mjs`, `node scripts/test-dashboard-security.mjs`, `node scripts/test-dashboard-operations.mjs`, `node scripts/test-dashboard-operations-review.mjs`, `node scripts/test-stripe-dashboard.mjs` e testes Deno em `supabase/tests/`. SQL de teste exige banco descartável, nunca execução indiscriminada em produção.

## Recuperação

Falha de leitura mantém o dado confirmado com aviso quando disponível. Não registrar diferença de saldo como receita/despesa artificial. Se uma gravação não foi confirmada, conferir o servidor antes de repetir; operações novas usam identidade de pedido para evitar duplicação quando aplicável.

Reverter o frontend não deve apagar dados novos. A versão anterior de Acessos não grava pelo contrato privado: para recuperar a interface, manter o módulo de segurança compatível. Nunca reabrir SELECT da coluna `senha` nem copiar segredos de volta para a tabela pública. Manter RPC e dados privados durante a correção. Desativar um cron novo se houver erro de sincronização, preservando cursores e recibos; uma sincronização financeira não deve apagar a classificação manual.

`ACESSOS_MASTER_HASH` guarda somente no servidor o hash vigente da senha mestra. Configuração ausente/inválida recusa a ação; não há fallback literal no código. Alterar aportes mantém o valor digitado como rascunho; os totais de aporte e caixa teórico usam a fotografia confirmada pelo servidor até o sucesso da gravação. “Salvar tudo” reenvia apenas snapshots pendentes/recusados, sem regravar todos os registros carregados.
