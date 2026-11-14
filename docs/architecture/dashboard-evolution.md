# Evolução do dashboard — decisões de arquitetura

Data: 2026-11-14. Responsável: @architect (Aria). Origem: auditoria do dashboard e aprovação explícita do usuário para implementar as correções e evoluções apresentadas. Este documento define contratos e ordem de integração; a criação dos arquivos de migração e o desenho físico final cabem ao executor de dados. Não registra credenciais nem comprova implantação futura.

## Restrições e forma de entrega

- Continuar HTML/CSS/JS estático e Supabase existente; sem framework, build ou infraestrutura nova.
- Preservar holding, ClickDrop e demais IDs atuais. Não restaurar empresas retiradas, não reclassificar histórico automaticamente e não modificar permissões do suporte para viabilizar a entrega.
- Alterações de banco aditivas, criadas pelo CLI `migration new`, conferidas contra o remoto e aplicadas individualmente pelo perfil isolado. Não usar `db push` neste histórico divergente.
- Publicar backend compatível antes do frontend. Quando uma proteção exigir cortar acesso inseguro, a alternativa de falha será erro explícito, nunca a reabertura do caminho inseguro.
- A inteligência proposta calcula alertas e explica fontes; não classifica recebimentos desconhecidos, movimenta dinheiro, envia respostas ou decide por conta própria.
- Persistência só confirma sucesso depois da resposta do servidor. Operações repetíveis de criação recebem `request_id` estável; a mesma tentativa devolve o resultado anterior, sem duplicar.

## 1. Acessos: metadados públicos autorizados e credencial privada

### Decisão

A correção imediata e a separação de armazenamento são duas fases do mesmo rollout. **Revogar a leitura da coluna de senha imediatamente**, preservando a leitura das colunas de metadados necessárias ao dashboard. Em seguida, copiar as credenciais para armazenamento em schema privado e centralizar as mutações/revelações em Edge Functions. Essa sequência fecha o contorno da senha mestra antes de depender de uma troca completa de interface.

Não basta manter a coluna fora do `select` do JavaScript: os metadados remotos demonstraram `SELECT` concedido à role `authenticated` e policy que exige somente holding. O cliente envia a senha como texto; o único trigger verificado apenas atualiza `updated_at`.

### Fronteiras

| Componente | Responsabilidade |
| --- | --- |
| `public.acessos_empresas` | Empresa, rótulo, URL, usuário, observação e campos de revisão. Nenhum segredo é legível pelo navegador. |
| Schema privado de credenciais | Valor associado ao ID do acesso, acessível apenas ao servidor por contrato interno restrito. Não expor esse schema na Data API. |
| Registro privado de eventos | ID do acesso, ator, ação, horário e resultado. Sem senha, senha mestra, token ou corpo arbitrário da requisição. |
| `acesso-senha` | Contrato de revelação compatível com `{id, mestra}`; aceita ação identificada `revelar`/`copiar` para auditoria. Autentica usuário, exige holding e valida mestra no servidor antes de devolver o segredo. |
| `acessos-manage` | Cria/edita/exclui acesso, atualiza revisão e lista eventos autorizados. Mutações de segredo e exclusão exigem validação da mestra; edição de metadados exige holding. |

O controle adicional da mestra permanece no servidor. Hash de mestra no cliente pode servir à experiência existente durante a transição, mas não participa da decisão de autorização final. A mestra não vai para URL, storage persistente, auditoria ou mensagens de erro.

Implementação de 14/11: a transição remove o hash do frontend e o configura somente no segredo de servidor `ACESSOS_MASTER_HASH`, preservando a senha vigente. Configuração ausente/inválida falha fechada; não existe fallback literal no código versionado.

### Contratos de mutação

`acessos-manage` recebe ações explícitas, IDs e somente campos permitidos. Para salvar, `senha` ausente significa manter; senha presente e não vazia significa substituir; apagar uma credencial exige ação explícita distinta, evitando interpretar um campo em branco de edição como exclusão. `request_id` identifica criação/repetição. A resposta contém exclusivamente metadados, nunca a credencial.

Para atomicidade entre metadados, credencial e auditoria, usar uma função interna transacional executável somente pela role de serviço. Se houver RPC em schema exposto para possibilitar chamada pelo SDK, revogar `EXECUTE` de `PUBLIC`, `anon` e `authenticated`, concedendo apenas à role de serviço; usar objetos totalmente qualificados e `search_path` fixo/vazio. A Edge Function faz a autorização do usuário antes de chamar esse contrato. Não criar RPC pública com `SECURITY DEFINER` para contornar RLS.

A auditoria registra revelação/cópia solicitada e autorizada. Ela não pode afirmar que o usuário efetivamente colou a credencial em outro aplicativo, nem que a operação local de clipboard teve sucesso. Revisão de credencial usa data de revisão e próxima revisão opcional definida pelo operador; não impor prazo de expiração arbitrário ou trocar senhas automaticamente.

### Migração e compatibilidade

1. Inventariar o endpoint remoto `acesso-senha` e guardar sua fonte no snapshot local ignorado; não capturar valores de senha. O endpoint anterior usa cliente do usuário para a leitura e deixa de funcionar depois da revogação: publicar primeiro uma versão compatível que autentica sessão/holding/mestra e lê o legado com cliente de serviço enquanto o contrato privado ainda não existir. Esse fallback é exclusivamente interno, temporário e explícito; nunca devolver segredo por listagem pública.
2. Com esse endpoint compatível confirmado, restringir `SELECT` da tabela pública a uma lista explícita de metadados para `authenticated`; retirar permissões de leitura de segredo e acesso de `anon`. Conferir que as queries atuais não usam `select('*')` nessa tabela. Aplicar a migração privada e trocar a leitura para ela; a ausência do contrato privado depois da migração é erro, não justificativa para reabrir o legado indefinidamente.
3. Criar estruturas privadas, funções internas e auditoria com privilégios fechados. Copiar segredos dentro do banco, sem materializar valores em terminal, arquivo SQL com literais, logs ou evidência. Conferir correspondência por IDs/contagens/expressões booleanas, nunca imprimindo os valores.
4. Publicar `acesso-senha` com leitura privada e compatibilidade do corpo antigo, mais `acessos-manage`. Durante rollout, uma credencial só pode usar fallback para o legado no servidor já autenticado, nunca via cliente. Não reabrir a leitura pública.
5. Publicar o frontend com listeners de eventos, referência por ID e texto escapado; remover o `onclick` que interpola usuário/senha. Passar gravações pelo endpoint de servidor e invalidar caches após mudança ou exclusão.
6. Bloquear mutações diretas do cliente e verificar testes positivos/negativos antes de considerar a migração concluída. Manter o legado inacessível somente durante a janela de rollback; sua limpeza final exige confirmar a cópia e a compatibilidade implantada. Nunca restaurar grants inseguros como rollback.

Não é necessário introduzir um gerenciador de segredos externo ou nova chave de criptografia do aplicativo para fechar o defeito identificado. O schema privado e os privilégios do servidor estabelecem a fronteira desta entrega. Isso não equivale a afirmar criptografia em nível de aplicação; qualquer promessa desse tipo exigiria desenho próprio de chaves e rotação.

### Sessões e rascunhos

Toda consulta de credencial captura `painelEpoch` e o ID do usuário/contexto antes da rede. A resposta é descartada se o contexto mudou; o mesmo vale antes de cachear, revelar ou copiar. Logout invalida primeiro o epoch, limpa caches e flags e depois aguarda o encerramento dos canais. Nenhuma resposta pendente pode reconstituir o cache anterior.

## 2. Gravação e renderização do dashboard

Valores de empresa, mês, ano, recorrência e sessão são capturados antes de uma operação assíncrona. Uma recorrência não consulta `selCompany` novamente a cada parcela. Erros do banco não alteram a lista confirmada e preservam o formulário; movimentos otimistas do calendário são revertidos se a gravação falhar.

Uma recorrência conserva empresa de origem. Antes de criar a proteção física, conferir duplicações existentes; o executor pode usar unicidade parcial por `(ano, mes, empresa_id, recorrencia_id)` para IDs de recorrência preenchidos. Isso impede repetir a mesma parcela no mesmo destino, mas não é suficiente, isoladamente, para impedir a mesma série em empresas diferentes: o contrato de gravação também deve capturar/verificar a empresa da série e rejeitar divergência. Repetir uma tentativa usa a mesma identidade, não gera novo UUID a cada retry.

Atualização automática e troca de vínculo financeiro passam por um fluxo de atualização de indicadores que preserva estado de edição. Não reconstruir o DOM do formulário aberto para atualizar apenas um KPI. Se a implementação mantiver renders completos, deve capturar/restaurar valores, identidade e visibilidade do rascunho sem restaurar campos de outra empresa ou sessão. O módulo de e-mail mantém sua proteção de rascunho/contexto existente.

Recriar assinaturas de Realtime após logout/login exige limpar todas as flags e timers correspondentes, inclusive Stripe e Nubank. O timer não substitui uma assinatura que foi removida enquanto a flag continuou verdadeira. Cargas e atualizações usam timeout e epoch; falha mantém o último valor com aviso de leitura antiga, sem fabricar saldo zero.

## 3. Leads e conversão de contatos

### Contrato lógico

Adicionar ao lead, sem alterar a identidade atual de projeto:

- responsável opcional;
- próxima ação textual e data/hora opcional;
- horário da última movimentação, mantido pelo servidor;
- referência opcional ao contato de origem;
- histórico de transições de status com origem, destino, ator e horário do servidor.

As regras de acesso continuam por empresa autorizada. Ter acesso à holding não implica acesso a uma filha por conveniência da interface; verificar os vínculos existentes antes de mostrar ou gravar dados do projeto. Histórico novo começa na implantação: um snapshot inicial não é uma transição comercial histórica e não pode sustentar taxa de conversão retroativa.

### Duplicidade

Normalizar e-mail por trim/minúsculas e telefone por dígitos, sem inventar código de país. Comparar dentro da empresa. Uma coincidência deve oferecer revisão/abertura do registro existente; não mesclar observações, trocar responsável ou mudar status automaticamente. Se e-mail e telefone apontarem para registros diferentes, tratar como conflito de revisão.

A prevenção de duplicação deve existir no contrato de gravação/transação para cobrir duas abas concorrentes. Antes de uma restrição física única, inspecionar duplicados já existentes; não apagar ou fundir registros históricos para fazer a migração passar. O executor de dados define índices/normalização e a resposta de conflito. A interface recebe apenas IDs que o usuário está autorizado a consultar.

### Converter contato em lead

O operador abre uma revisão com os dados do contato e escolhe um projeto financeiro autorizado. Nomes do portfólio público não são IDs financeiros: projetos sem correspondência exigem escolha explícita; não usar slug adivinhado como empresa financeira.

Contrato `converter-contato` recebe `contato_id`, `empresa_id`, campos revisados e `request_id`. O servidor exige acesso ao contato (holding) e à empresa de destino; cria/vincula o lead em transação. Uma referência única de contato de origem torna a repetição idempotente. Repetir a conversão retorna o vínculo existente autorizado, sem criar outro lead nem sobrescrever o que o usuário já editou. Conversão não envia mensagem nem altera o contato original silenciosamente.

Alertas de leads usam fatos existentes: próxima ação vencida, ausência de responsável/ação e dias desde última movimentação. O status atual sozinho não mede tempo entre etapas ou conversão histórica; tais métricas passam a usar eventos coletados após a implantação.

## 4. Sócios e reembolsos

Manter aportes e custos pessoais históricos como fontes originais. Acrescentar registros identificados de reembolso com sócio, valor, data do pagamento realizado, referência/observação, ator e `request_id`. Quando houver alocação a uma despesa, guardar a referência à origem sem reescrever a despesa.

Registrar reembolso significa registrar um pagamento já efetuado pelo operador; **não executar transferência financeira**. Uma previsão futura é apresentada separadamente e não baixa a dívida atual.

Regras:

- despesa paga pessoalmente gera obrigação de reembolso, aporte não;
- reembolso confirmado reduz o saldo a devolver, sem reduzir aporte societário ou participação e sem lançar custo pela segunda vez;
- totais mostram despesa pessoal bruta, reembolsado e saldo pendente, com período identificado;
- o servidor valida sócio, valores positivos, acesso à holding e impedimento de mutação por página Balanço bloqueada, mantendo a leitura agregada já autorizada nas outras páginas;
- a mesma tentativa não gera duas baixas; concorrência deve conferir o saldo pendente dentro da transação;
- revisão/correção de um registro fica identificada, sem apagar silenciosamente a origem da obrigação.

O esquema físico pode usar registros de pagamento e alocações a origens, desde que a identidade e a prevenção de dupla baixa sejam mantidas. Não preencher reembolsos históricos por suposição. A tela atual não contém prova de liquidação anterior.

## 5. E-mail recuperável e pendências

Preservar `{mailbox_id, reply_to_id}` e a autorização interna das funções existentes. Não criar envio automático, retry de SMTP incerto ou inferência de remetente a partir de empresa financeira.

Para recuperação local incremental, usar storage da aba e chave composta pelo usuário autenticado, caixa, tipo de composição e original da resposta. Recuperação após refresh exige o mesmo usuário/caixa e confirmação do contexto. Logout ou troca de usuário remove os rascunhos da sessão que saiu; não armazenar senha mestra, credenciais SMTP ou tokens com o rascunho. A interface deve dizer que a recuperação é desta aba, sem prometer sincronização entre dispositivos ou recuperação após fechar o navegador. Se a implementação optar por persistência no servidor, uma tabela própria com autorização de caixa/usuário e contrato dedicado deve substituir essa decisão explicitamente.

Salvar rascunho de forma debounced não envia mensagem. Somente sucesso SMTP conhecido limpa o rascunho de envio; resultado incerto preserva texto e aviso e não aciona reenvio. Respostas carregam o original autorizado antes de afirmar que o histórico está incluído.

Busca/paginação são por caixa e direção, com limite/cursor e filtro de busca explícitos. A lista carregada parcialmente não pode produzir contador com aparência de total completo.

“Sem resposta” só é um fato confiável com vínculo de resposta persistido ou metadados de encadeamento importados. Para respostas enviadas pelo dashboard, registrar o ID original autorizado no servidor. Mensagens históricas ou respondidas fora do dashboard sem vínculo conhecido devem ser rotuladas como “sem resposta registrada”, evitando afirmar que o usuário nunca respondeu. Não reconstruir histórico de conversão ou SLA a partir de leitura/não leitura.

## 6. Financeiro: identidade, referência e projeção

Cada saldo identifica conta, moeda e três conceitos de tempo distintos:

- `consultado_em`: quando a Edge Function fez a consulta;
- `atualizado_em`: atualização informada pelo provedor, se conhecida;
- `saldo_referencia_em`: referência do relatório/snapshot usado, se conhecida.

Campos desconhecidos ficam nulos. Uma consulta feita agora não transforma relatório antigo em saldo atualizado agora. Uma leitura parcial ou antiga mantém aviso visível, data da fonte e motivo; nunca vira total completo ou zero fictício.

Nubank usa identidade explícita da conta Pluggy. Durante compatibilidade, somente a correspondência exata já conhecida pode ser aceita; remover `correntes[0]`. Ausência/divergência resulta em erro identificável, sem colar o saldo de outra conta nos dados bancários fixos de Nu Empresas.

Stripe mantém credenciais e identidade separadas por conta; ClickDrop não substitui holding. Bruto/taxa/líquido permanecem por moeda. Disponível entra no Caixa Atual; pendente só aparece em previsões e a liberar. Sem fonte de câmbio identificada, moedas diferentes não são consolidadas como reais.

Previsão por data usa disponibilização informada pelo provedor. Data de disponibilidade de uma cobrança não é garantia de repasse bancário. Uma previsão construída com cobranças deve indicar cobertura e diferenças de taxas, ajustes, estornos e repasses; não prometer reconciliação exata com saldo pendente usando apenas a lista de vendas.

Runway e caixa teórico reconciliam custos dos modelos preservados e taxas dos gateways sem dupla contagem. Aporte societário pode continuar bruto, mas a entrada financeira e a taxa são identificadas separadamente. O saldo disponível de API não é substituído por esse cálculo teórico.

### Revisão histórica Stripe

Manter o incremental das cobranças recentes a cada dois minutos e acrescentar estado de revisão histórica por conta (`stripe_sync_state`). O escritor é exclusivamente servidor; leitura operacional exige holding e respeita o bloqueio Stripe. A tabela/contrato guarda cursor histórico, início da rodada, último lote, última rodada concluída e erro sanitizado. Não incluir chave ou payload financeiro integral.

Uma rodada histórica começa por janela agendada (por exemplo, a cada seis horas), percorre páginas até o fim e só então atualiza `full_completed_at`. O executor limita o trabalho por chamada, conserva o cursor ao atingir o teto e retoma lotes posteriores; enquanto a rodada estiver ativa, o cron frequente pode avançar um lote histórico além do incremental, evitando que um histórico grande leve vários dias. Cursor e limite são próprios por conta. Falha de uma não impede a outra.

`full=true` é uma solicitação, não prova de cobertura: resposta/indicador deve distinguir lote concluído, rodada ainda em andamento e última revisão histórica completa. Uma falha não apaga o horário da rodada anterior bem-sucedida, mas sinaliza que a rodada nova está incompleta. Um estorno de cobrança antiga deve aparecer após a revisão, preservando o vínculo manual e sem duplicar recebimento. Isso atende a cobertura histórica pelo polling atual, sem pressupor criação de webhook ou alteração de configuração comercial no Stripe.

## 7. Verificação e rollout

Entregar contratos testáveis por CLI antes da interface. Testes de credenciais devem usar fixtures e consultas booleanas/contagens; nunca ler senha real como prova. Executar cenários de autorização sem sessão, usuário sem holding, página bloqueada, mestra incorreta, segredo ausente/inalterado e replay de mutação. Conferir que nenhuma API de navegador permite `SELECT senha` ou recebe uma credencial em resposta de listagem.

Para operação, testar erro de INSERT/UPDATE, troca de empresa durante await, resposta após logout, duas abas concorrentes, idempotência e atualização automática com rascunho aberto. Para finanças, usar dados das duas contas e casos de moeda diferente, taxa de aporte, meta negativa, conta Pluggy divergente e leitura parcial/antiga.

Depois de aplicar a migração específica e publicar funções, confirmar comportamento remoto sem expor segredos, publicar frontend por @devops e confirmar Vercel READY no SHA exato. Validar desktop/mobile/console quando a ferramenta permitir. Registrar indisponibilidade real, sem tratar revisão de código ou VM como inspeção visual.

Rollback mantém RLS/grants fechados, dados novos e histórico de auditoria. Pode voltar a interface/handlers compatíveis e desabilitar novas mutações com erro explícito; não desfazer liquidações financeiras, apagar eventos, restaurar leitura pública de segredo ou reclassificar recebimentos para mascarar falha.
