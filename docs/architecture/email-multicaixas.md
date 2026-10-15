# E-mail multicaixas — arquitetura de implementação

Status: integração concluída em 2026-10-15, com migração aplicada, cinco funções publicadas e sete caixas verificadas por IMAP/SMTP na Hostinger. A caixa legada é `suporte@arcadehub.tech`; as seis adicionais tiveram credenciais cadastradas pelo assistente local e sincronização confirmada. O discovery retorna todas com `status = verified`, `can_sync = true` e `can_send = true`. Nenhuma entrega de e-mail externo foi testada. O frontend habilita o seletor e só libera as operações confirmadas pelo servidor.

## Estado anterior à migração

Backups das três funções estão em `.aiox/email-backend-before-20261015/supabase/functions/`. A integração atual usa credenciais globais `IMAP_USER`/`IMAP_PASS`, com fallback para `SMTP_USER`/`SMTP_PASS`; envio usa `SMTP_FROM` ou `SMTP_USER`.

- `email-sync` usa `service_role`, busca os últimos 60 registros por padrão e deduplica `uid_imap` globalmente. Não autentica a chamada no código, e o gateway está com `verify_jwt=false`.
- `email-body` autentica o usuário, mas aceita UID do cliente e atualiza o registro por `id` usando `service_role`, sem autorização da caixa. A evolução deve resolver identidade exclusivamente do registro autorizado.
- `email-send` autentica o usuário, usa uma conta SMTP global e não verifica erro da gravação do histórico após SMTP. A evolução precisa distinguir entrega efetuada de falha posterior no histórico, para evitar reenvio automático duplicado.
- Cron `email-sync-incremental`, job 3, está ativo a cada três minutos (`*/3 * * * *`) e chama `email-sync` sem autenticação. Corrigir a função sem adaptar esse cron interromperia a sincronização automática.

## Ativação e compatibilidade

`EMAIL_MULTICAIXAS = true` habilita o contrato validado. Durante a preparação, `false` preservou as chamadas legadas. A caixa existente foi confirmada como `suporte@arcadehub.tech` no bootstrap real.

O backend, as permissões e a caixa existente foram validados antes de habilitar a flag. Uma caixa sem credenciais verificadas aparece como pendente e não opera até autenticá-las; as sete caixas solicitadas já concluíram essa etapa. Qualquer erro de discovery ou contrato inválido bloqueia a operação multicaixas e apresenta a falha. Não há fallback automático para credenciais ou chamadas legadas.

No servidor, chamadas antigas sem `mailbox_id` resolvem exclusivamente a caixa `arcade_hub`, com autorização explícita e seus secrets existentes. Identificador informado, mas inválido ou não autorizado, nunca recai nessa caixa. A migração precisa vincular o histórico existente à caixa legada antes das novas gravações.

## Discovery

Para cadastrar as seis senhas localmente, executar `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\conectar-emails.ps1`. O assistente solicita a senha de cada caixa, com digitação oculta; Enter vazio pula uma conta. Depois, no dashboard autenticado, selecionar a caixa e clicar em **Verificar conexão** e **Sincronizar**. Usar a senha do webmail da caixa, não a senha do painel Hostinger. Nenhuma senha deve ser colada no chat.

Após autenticação e antes da leitura das mensagens, invocar `email-accounts`. Resposta proposta:

```json
{
  "version": 1,
  "capabilities": { "mailbox_scoping": true },
  "accounts": [
    {
      "id": "identificador-estavel",
      "email": "endereco-confirmado@exemplo.com",
      "label": "Nome da caixa",
      "can_send": true,
      "can_sync": true
    }
  ]
}
```

Os valores do exemplo são ilustrativos. A lista contém somente contas que o usuário autenticado pode ler. `can_send` e `can_sync` são permissões explícitas por conta. A resposta não inclui senhas ou outros segredos. `accounts: []` significa que nenhuma caixa está disponível para esse usuário e mantém as operações desabilitadas.

Contas cadastradas podem aparecer antes de suas credenciais estarem disponíveis: nesse caso `can_send` e `can_sync` são `false`. Existência no cadastro não significa conexão com Hostinger. As capacidades combinam autorização, secret disponível e verificação bem-sucedida: `smtp_verified_at` para envio e `imap_verified_at` para sincronização. Presença de um secret, por si só, não comprova que a senha funciona.

O cliente exige `version: 1`, `mailbox_scoping: true` e contas válidas. Os identificadores são estáveis e únicos; `email` contém o endereço completo confirmado. Não completar os domínios abreviados informados na solicitação nem criar contas a partir deles.

## Escopo das operações

No modo multicaixas, cada mensagem possui `mailbox_id`. A listagem consulta `emails` com `eq('mailbox_id', caixaSelecionada)` antes de ordenar e limitar. Atualização de leitura e exclusão também restringem por `id` e `mailbox_id`.

| Função | Corpo no modo multicaixas |
| --- | --- |
| `email-sync` | `{ mailbox_id }` |
| `email-send` | `{ mailbox_id, to, cc, subject, text }` |
| `email-body` | `{ mailbox_id, id, uid_imap }` |

Os formatos de resposta já consumidos pela interface são preservados: sincronização usa `ok`, `novos` e `error`; envio usa `ok` e `error`; corpo usa `ok`, `corpo_texto`, `corpo_html` e `error`.

O backend precisa autenticar e autorizar cada operação. Deve conferir que a mensagem pertence à caixa solicitada; `uid_imap` recebido do navegador não constitui autorização. A conta SMTP e o remetente são resolvidos no servidor a partir de `mailbox_id`. Uma caixa inválida ou não autorizada deve falhar, nunca usar a conta padrão. As consultas diretas precisam de RLS compatível; filtrar a interface não substitui autorização.

As funções validam o usuário com Auth e a permissão de acesso da holding antes de abrir sockets ou consultar mensagens com privilégios administrativos. Usuários vinculados apenas a uma empresa filha não recebem automaticamente acesso ao correio da holding. `email-body` exige um registro autorizado mesmo quando `uid_imap` foi enviado; valida caixa, direção e identidade IMAP antes de usar cache ou buscar conteúdo.

## Credenciais por caixa

Manter os secrets globais existentes exclusivamente para `arcade_hub`. Para cada caixa adicional, usar um secret independente `MAILBOX_<ID_MAIUSCULO>_PASS_B64`, onde o ID vem do cadastro permitido pelo servidor. Exemplos: `MAILBOX_CBAI_SOLUTIONS_PASS_B64` e `MAILBOX_LIQUIDA_PECAS_PASS_B64`. O valor é base64 dos bytes UTF-8 da senha, para preservar caracteres especiais no arquivo dotenv; o servidor decodifica antes de autenticar. Base64 não é criptografia. Não aceitar nomes arbitrários de variáveis vindos da requisição.

Para essas contas Hostinger, usuário IMAP, usuário SMTP e remetente são o endereço cadastrado; IMAP e SMTP usam a mesma senha dessa caixa. Os hosts e portas são os confirmados nas referências. Senha ausente desabilita sincronização e envio daquela conta, sem reutilizar a senha da holding. Permissões e metadados ficam no banco; senhas ficam nos secrets das Edge Functions.

O cadastro das senhas será executado pelo usuário em terminal local, sem enviá-las no chat. O helper [configurar-caixas-email.ps1](../../scripts/configurar-caixas-email.ps1) foi preparado com este fluxo:

1. Validar caixa e projeto fixos; coletar senha com `Read-Host -AsSecureString`.
2. Criar diretório temporário fora do repositório com ACL restrita ao usuário atual. Rejeitar senha com CR, LF ou NUL antes de qualquer operação remota; converter a senha válida apenas para gerar um `.env` efêmero com o valor em base64.
3. Usar `supabase@2.121.0 db query` para limpar `imap_verified_at` e `smtp_verified_at` e incrementar `credentials_revision` antes de alterar o secret. Se não existir a caixa ou a operação falhar, abortar sem alterar a senha. Isso evita que uma senha nova herde verificação antiga.
4. Executar o CLI fixado `supabase@2.121.0 secrets set --env-file <arquivo> --project-ref zdwgwpvlwqtsdgervcof --profile <perfil-isolado>`. Não passar a senha como argumento `NAME=VALUE`, imprimir o conteúdo, ativar debug ou salvar em transcript. Depois da tentativa, mesmo se houver erro, limpar novamente os timestamps e incrementar a revisão para invalidar checks iniciados durante o upload. Se essa segunda atualização falhar, avisar que a situação é incerta e pedir nova execução antes de usar a caixa.
5. Em `finally`, apagar o arquivo temporário, liberar a memória BSTR usada na conversão, zerar os bytes e remover referências à senha. O processo precisa de texto em memória temporariamente; `SecureString` não elimina essa etapa.
6. Mostrar apenas sucesso ou erro sanitizado; verificar a conexão depois no dashboard autenticado. Testes de envio externo dependem de autorização e destinatário definidos separadamente.

O suporte a `--env-file` foi confirmado em `secrets set --help`; não se presume suporte a stdin. O helper passou por testes com CLI e entrada simulados: sucesso, falha ao invalidar antes/depois do cadastro, falha ao cadastrar, rejeição de senha com quebra de linha antes de chamar o CLI, preservação de caracteres especiais válidos e limpeza do arquivo temporário. Nenhuma senha real foi coletada ou cadastrada nesses testes.

Uso local quando o usuário estiver pronto, após aplicar o cadastro das caixas no banco:

```powershell
.\scripts\configurar-caixas-email.ps1 -Mailbox cbai_solutions
```

IDs permitidos: `cbai_solutions`, `jogadaca`, `coben`, `privabr`, `liquida_pecas`, `conferecheck`. `-ProfilePath` permite indicar outro perfil autorizado; o padrão é o perfil local isolado do projeto. Não rotacionar secrets adicionais por fora desse fluxo. `email-check` captura `credentials_revision` ao carregar a conta e atualiza timestamps somente se a revisão continuar igual; atualização sem linha retorna conflito e solicita repetir a verificação.

### Verificação autenticada

`email-check` recebe `{ mailbox_id }`, exige acesso da holding e testa IMAP LOGIN/SELECT e SMTP AUTH com TLS, sem enviar mensagem. Registra resultados independentes e timestamps somente para protocolos autenticados com sucesso. Falha deixa a respectiva capacidade indisponível. A interface oferece a verificação para contas autorizadas mesmo quando suas capacidades de envio/sincronização estão desabilitadas; erros não retornam senha, comando de autenticação ou transcript do servidor.

A caixa legada mantém sua configuração existente e precisa da verificação equivalente para a readiness do novo fluxo. O backend não deve executar SMTP MAIL FROM, RCPT TO ou DATA em `email-check`.

## Identidade IMAP e histórico

Manter `uid_imap` no formato existente `INBOX:<uid>` e registrar `imap_uidvalidity` obtido ao selecionar a pasta. A identidade de deduplicação inclui caixa, pasta, UIDVALIDITY e UID; não deduplicar contas diferentes por UID ou `Message-ID` global. O banco deve garantir unicidade dessa identidade contra sincronizações concorrentes. O mecanismo é definido pela [RFC 9051, seção 2.3.1.1](https://www.rfc-editor.org/rfc/rfc9051.html#section-2.3.1.1).

Os registros legados começam com UIDVALIDITY desconhecido. Não preencher todos com o valor atual indiscriminadamente: conferir o UID e o `Message-ID` original antes de reconciliar cada registro, preservando `id`, estado de leitura e corpo em cache. Os 66 recebidos inspecionados têm `Message-ID` e UID válidos, mas a igualdade com o servidor ainda precisa ser verificada. Ausência de correspondência não autoriza sobrescrever o histórico.

`email-body` compara a época armazenada com a devolvida pelo servidor. Se diferirem, não busca o corpo pelo UID antigo; mantém eventual cache histórico e solicita nova sincronização. Para legado sem época, exigir correspondência da identidade antes de associar conteúdo remoto. Quando UIDVALIDITY mudar, importar a nova identidade sem substituir mensagens anteriores.

## Sincronização agendada

Antes de publicar autenticação obrigatória em `email-sync`, adaptar o cron existente. Usar segredo de máquina dedicado `EMAIL_SYNC_CRON_TOKEN` nos secrets da função, cópia no Vault sob o nome `email_sync_cron_token` e header `x-email-cron-token` validado pela função. Não inserir seu valor em SQL versionado, logs ou argumentos de shell. O responsável pela publicação gera e provisiona esse token sem exibir seu valor.

Chamada humana exige usuário e permissão de caixa; chamada agendada exige o segredo de máquina válido. Token anônimo, JWT apenas decodificado ou ausência de `mailbox_id` não concedem acesso de máquina. Inicialmente preservar o alvo legado; com as verificações prontas, o cron autenticado percorre caixas habilitadas com secret disponível e `imap_verified_at` preenchido. Resultados são independentes e erro em uma conta não impede as demais. Preservar frequência existente, limitar trabalho por caixa e registrar resultados sanitizados. Não considerar a agenda adaptada enquanto um disparo real não tiver sido observado com autenticação e sem expor segredos.

## Interface, sessão e concorrência

- O compositor mostra o remetente e vincula o rascunho à caixa escolhida. Responder vincula o rascunho à caixa da mensagem original. Trocar de caixa com rascunho exige confirmação de descarte; cancelar mantém caixa e conteúdo.
- A recarga limpa a lista anterior enquanto busca a nova caixa. Indicadores, contagem e mensagens sempre correspondem à caixa ativa.
- Cada operação captura a sessão e a seleção vigentes. Respostas atrasadas não podem alterar outra caixa ou uma sessão posterior; o envio captura o remetente antes de aguardar a rede.
- Logout invalida operações pendentes e limpa contas, seleção, rascunho, corpos carregados, conjuntos auxiliares e indicadores. Os canais anteriores são removidos antes de uma nova sessão assinar eventos.
- Realtime incorpora apenas mensagens da caixa e sessão vigentes. Exclusões usam `payload.old`; evento sem dados suficientes provoca recarga filtrada. O indicador de conexão deve refletir o estado real da assinatura.
- Endereços e rótulos são escapados na renderização. Corpos HTML permanecem em iframe com sandbox.

## Pendências para conectar as contas reais

Endereços adicionais confirmados pelo usuário em 2026-10-15:

- `suporte@cbaisolutions.com.br`
- `contato@jogadaca.ai`
- `contato@coben.app`
- `suporte@privabr.com.br`
- `contato@liquidapecas.com.br`
- `contato@conferecheck.com.br`

Manter a caixa existente. Sua identidade de sincronização ainda não foi confirmada. A lista acima é inventário solicitado, não prova de conexão ou disponibilidade de credenciais.

1. Concluir revisão da migração e autorização a partir das funções e do esquema remoto já inspecionados; nenhuma mudança remota é afirmada por este documento.
2. Verificar as contas confirmadas acima na Hostinger e configurar suas credenciais e autorizações no servidor.
3. Adaptar e validar discovery, sincronização, leitura do corpo e envio; manter credenciais exclusivamente no servidor.
4. Vincular o histórico à caixa correta, garantir isolamento dos identificadores IMAP entre contas e aplicar autorização no banco e nas funções.
5. Adaptar a autenticação do cron e validar recebimento, sincronização e autorização de envio em cada caixa antes de habilitar a flag em produção. Os testes desta implementação não enviam mensagens reais.

Mocks no navegador devem cobrir legado, duas caixas, nenhuma conta, discovery negado ou inválido, troca durante carregamento/envio e logout durante leitura. Eles verificam a interface e o contrato proposto, sem comprovar autenticação Hostinger ou entrega de e-mail.

## Referências operacionais

- [Hostinger — configuração de contas de e-mail](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/): IMAP `imap.hostinger.com`, SSL, porta 993; SMTP `smtp.hostinger.com`, SSL, porta 465. Confirmar os dados da conta no painel ao configurar.
- [Supabase — secrets de Edge Functions](https://supabase.com/docs/guides/functions/secrets): configuração de segredos no ambiente servidor, sem inseri-los no HTML ou no contrato de discovery.
