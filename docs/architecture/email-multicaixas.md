# E-mail multicaixas — arquitetura de implementação

Status: integração concluída em 2026-10-15, com migração aplicada, cinco funções publicadas e sete caixas verificadas por IMAP/SMTP na Hostinger. A caixa legada é `suporte@arcadehub.tech`; as seis adicionais tiveram credenciais cadastradas pelo assistente local e sincronização confirmada. O discovery retorna todas com `status = verified`, `can_sync = true` e `can_send = true`. Nenhuma entrega de e-mail externo foi testada. O frontend habilita o seletor e só libera as operações confirmadas pelo servidor.

## Estado anterior à migração

Registro histórico anterior à story 1.2; não descreve o backend hoje publicado.

Backups das três funções estão em `.aiox/email-backend-before-20261015/supabase/functions/`. Naquele snapshot, a integração usava credenciais globais `IMAP_USER`/`IMAP_PASS`, com fallback para `SMTP_USER`/`SMTP_PASS`; envio usa `SMTP_FROM` ou `SMTP_USER`.

- `email-sync` usa `service_role`, busca os últimos 60 registros por padrão e deduplica `uid_imap` globalmente. Não autentica a chamada no código, e o gateway está com `verify_jwt=false`.
- `email-body` autentica o usuário, mas aceita UID do cliente e atualiza o registro por `id` usando `service_role`, sem autorização da caixa. A evolução deve resolver identidade exclusivamente do registro autorizado.
- `email-send` autentica o usuário, usa uma conta SMTP global e não verifica erro da gravação do histórico após SMTP. A evolução precisa distinguir entrega efetuada de falha posterior no histórico, para evitar reenvio automático duplicado.
- Cron `email-sync-incremental`, job 3, está ativo a cada três minutos (`*/3 * * * *`) e chama `email-sync` sem autenticação. Corrigir a função sem adaptar esse cron interromperia a sincronização automática.

## Ativação e compatibilidade

`EMAIL_MULTICAIXAS = true` habilita o contrato validado. Durante a preparação, `false` preservou as chamadas legadas. A caixa existente foi confirmada como `suporte@arcadehub.tech` no bootstrap real.

O backend, as permissões e a caixa existente foram validados antes de habilitar a flag. Uma caixa sem credenciais verificadas aparece como pendente e não opera até autenticá-las; as sete caixas solicitadas já concluíram essa etapa. Qualquer erro de discovery ou contrato inválido bloqueia a operação multicaixas e apresenta a falha. Não há fallback automático para credenciais ou chamadas legadas.

No servidor, chamadas antigas sem `mailbox_id` resolvem exclusivamente a caixa `arcade_hub`, com autorização explícita e seus secrets existentes. Identificador informado, mas inválido ou não autorizado, nunca recai nessa caixa. A migração vinculou o histórico existente à caixa legada antes das novas gravações.

## Discovery

As seis senhas adicionais já foram cadastradas e verificadas. Para recadastro solicitado ou rotação, executar `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\conectar-emails.ps1`. O assistente solicita a senha de cada caixa, com digitação oculta; Enter vazio pula uma conta. Depois, no dashboard autenticado, selecionar a caixa e clicar em **Verificar conexão** e **Sincronizar**. Usar a senha do webmail da caixa, não a senha do painel Hostinger. Nenhuma senha deve ser colada no chat.

Após autenticação e antes da leitura das mensagens, invocar `email-accounts`. Contrato publicado (exemplo mínimo):

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
| `email-send` | `{ mailbox_id, to, cc, subject, text, reply_to_id?, quoted_text? }` |
| `email-body` | `{ mailbox_id, id, uid_imap }` |

Os formatos de resposta já consumidos pela interface são preservados: sincronização usa `ok`, `novos` e `error`; envio usa `ok` e `error`; corpo usa `ok`, `corpo_texto`, `corpo_html` e `error`.

O backend precisa autenticar e autorizar cada operação. Deve conferir que a mensagem pertence à caixa solicitada; `uid_imap` recebido do navegador não constitui autorização. A conta SMTP e o remetente são resolvidos no servidor a partir de `mailbox_id`. Uma caixa inválida ou não autorizada deve falhar, nunca usar a conta padrão. As consultas diretas precisam de RLS compatível; filtrar a interface não substitui autorização.

As funções validam o usuário com Auth e a permissão de acesso da holding antes de abrir sockets ou consultar mensagens com privilégios administrativos. Usuários vinculados apenas a uma empresa filha não recebem automaticamente acesso ao correio da holding. `email-body` exige um registro autorizado mesmo quando `uid_imap` foi enviado; valida caixa, direção e identidade IMAP antes de usar cache ou buscar conteúdo.

## Novo e-mail e resposta pela caixa selecionada — story 1.3

Decisão aprovada para implementação: usar o SMTP e o remetente definidos no servidor para a caixa selecionada tanto em mensagem nova quanto em resposta. Esta seção descreve a evolução da story 1.3; não afirma que seus ajustes já foram publicados. O campo `message_id` existente comporta a identidade das mensagens enviadas, sem nova migração.

`reply_to_id` é opcional e identifica o registro recebido que originou a resposta. Quando presente, precisa ser um ID válido; não aceitar valor malformado como ausência. Após autorizar a caixa, o servidor consulta `id`, `message_id` e `direcao` pelo cliente autenticado com RLS, restringindo por `id` e `mailbox_id`. Registro inexistente, de outra caixa ou com direção diferente de `in` impede o envio antes de criar tentativa ou abrir SMTP. O navegador não fornece remetente, `Message-ID`, `In-Reply-To`, `References` ou headers livres.

Para cada tentativa, o servidor gera `<UUID@dominio-do-remetente-configurado>` e persiste esse mesmo valor em `emails.message_id` junto ao registro `pendente`, antes de chamar SMTP. Mensagem nova recebe somente esse identificador. Resposta com identificador original seguro recebe também `In-Reply-To` e `References`, ambos com o `message_id` do registro de origem. Esses cabeçalhos vinculam a resposta à mensagem anterior; a cadeia completa de ancestrais não é reconstruída, pois o histórico atual não armazena `References`. A semântica é definida na [RFC 5322, seção 3.6.4](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.4).

O identificador original é conteúdo externo: aceitar apenas um `msg-id` de formato conservador, com delimitadores `<...>`, tamanho limitado e sem caracteres de controle, espaços internos ou cabeçalhos adicionais. Valor ausente ou fora desse formato não bloqueia a resposta: omitir os dois cabeçalhos de encadeamento e manter o remetente, destinatário, assunto e conteúdo. A interface não promete agrupamento de conversa nesse caso; nenhum valor suspeito é repassado ao SMTP.

Na versão fixa `denomailer@1.6.0`, usar `headers` com chaves explícitas `Message-ID`, `In-Reply-To` e `References`. Não existe opção pública `messageId`; `send()` retorna `Promise<void>`. A opção `inReplyTo` dessa versão escreve `InReplyTo:` sem hífens, portanto não deve ser usada. O caminho padrão inspecionado não gera `Message-ID` automaticamente. Não preencher `inReplyTo` ou `references` em paralelo aos headers customizados, evitando duplicidade. Essas decisões vêm do [tipo de configuração](https://github.com/EC-Nordbund/denomailer/blob/1.6.0/config/mail/mod.ts), do [cliente SMTP](https://github.com/EC-Nordbund/denomailer/blob/1.6.0/client/basic/client.ts#L109-L124) e do [retorno público de envio](https://github.com/EC-Nordbund/denomailer/blob/1.6.0/client/mod.ts#L128-L138).

O compositor distingue **Novo e-mail** e **Responder**, mostra o remetente e mantém `reply_to_id` vinculado à caixa de origem. **Novo e-mail** limpa destinatário, cópia, assunto, corpo e referência de resposta após confirmar o descarte quando houver rascunho. **Cancelar** também limpa a referência; recusar o descarte mantém o estado inteiro. Abrir outra resposta ou trocar a caixa não pode transportar silenciosamente o vínculo anterior. Enquanto o envio estiver em andamento, bloquear ações que substituam o rascunho; conclusão de uma requisição antiga nunca apaga um rascunho mais recente.

Preservar feedback de erro, sucesso e entrega aceita com falha posterior no histórico. Não reenviar automaticamente em resultado SMTP incerto. Validação local deve conferir remetente e domínio gerado para cada caixa, igualdade entre `message_id` persistido e transmitido, rejeição de resposta cruzada ou ID inválido, fallback sem headers para identificador original ausente/malformado e transições do compositor. Usar mocks de SMTP e navegador, sem entrega externa de teste.

## Assinaturas visuais por caixa — story 1.4

Decisão aprovada para implementação, sem migração: um mapa compartilhado no backend associa `mailbox.id` autorizado à arte pública, texto alternativo e dimensões. `arcade_hub` e `cbai_solutions` usam explicitamente a arte Arcade; `privabr`, `jogadaca`, `conferecheck` e `liquida_pecas` usam suas respectivas artes fornecidas. `coben` permanece sem imagem enquanto sua definição estiver pendente. Não existe fallback visual genérico nem escolha de `signature_id`, URL ou HTML pelo navegador. Dados das artes não serão modificados por esta integração.

`email-accounts` pode expor metadados opcionais de preview com URL e `alt`, obtidos desse mapa, sem alterar o contrato de autorização. `email-send` resolve novamente a assinatura pelo mesmo mapa e pela caixa autorizada; não confia no preview devolvido pelo cliente. Uma conta sem arte mantém identificação textual com nome e endereço confirmados, sem inventar pessoa, telefone, cargo ou site.

O frontend atualizado envia `text` somente com o texto novo e sempre inclui `quoted_text`: string vazia em mensagem nova; histórico em texto simples separado em resposta. Uma citação não vazia exige `reply_to_id` válido, cuja autorização e escopo continuam sendo conferidos no servidor. Recomenda-se enviar a citação que a interface apresenta, sem uma nova busca IMAP durante o envio: a citação é conteúdo escrito pelo remetente, não prova de identidade ou permissão. Ambos os textos são escapados antes de gerar HTML; não inserir o HTML original recebido nem aceitar HTML livre do pedido.

A montagem é única e ocorre no servidor: **texto novo → identificação textual e imagem da assinatura → histórico citado**. O HTML põe o histórico em `blockquote`, com a assinatura fora dele. Texto simples usa a mesma ordem e identificação textual, sem URL da imagem ou marcação HTML. Assinaturas já presentes no histórico são preservadas como citação; não contam como duplicação da assinatura ativa. Guardar exatamente as versões finais de texto e HTML em `emails` antes de entregá-las ao SMTP, preservando as regras de tentativa, resultado incerto e cabeçalhos da story 1.3.

Compatibilidade deliberada: pedidos antigos sem `quoted_text` tratam `text` como corpo integral e recebem a assinatura ao final, sem tentar separar marcadores editáveis como `--- Em ... escreveu`. Assim continuam assinados e enviáveis, embora uma resposta de cliente antigo mantenha a assinatura depois do corpo integral. A posição entre texto novo e histórico é garantida pelo contrato separado da UI atualizada. Ausência, string vazia e valor de tipo inválido não devem ser confundidos; este último é rejeitado. Limites de tamanho devem evitar truncamento silencioso que torne o envio diferente do preview.

Usar `content` e `html` explícitos no `denomailer@1.6.0`; o [código de composição da biblioteca](https://github.com/EC-Nordbund/denomailer/blob/1.6.0/config/mail/content.ts) gera partes `text/plain` e `text/html` em quoted-printable. `<img src="https://arcadehub.tech/...">` permanece referência remota no HTML: não é attachment, CID ou base64 e não exige buscar a imagem no servidor durante o envio. O layout deve usar CSS inline simples, `alt`, dimensão proporcional e identificação textual visível mesmo com imagens bloqueadas. O preview usa a caixa do rascunho, não apenas o filtro selecionado; não injeta assinatura no textarea a cada renderização. Na CSP atual do admin, URLs de preview precisam ser same-origin ou ter a origem HTTPS canônica autorizada explicitamente, sem liberar imagens de qualquer domínio.

Sequência de publicação:

1. Publicar somente os assets de assinatura em caminhos estáveis e versionados, mantendo as artes anteriores acessíveis para e-mails já enviados. Confirmar Vercel READY e GET anônimo HTTPS com status 200, `Content-Type` correto e dimensões esperadas de cada arquivo. Não apontar para Downloads nem publicar outros arquivos locais.
2. Publicar o helper e as funções que expõem o preview e compõem o envio, somente depois de confirmar os assets. O contrato legado continua válido durante esta etapa. O backend deve estar disponível antes de publicar a UI que envia `quoted_text`.
3. Publicar o frontend e validar preview desktop/mobile, CSP, rascunhos e falhas de imagem. Confirmar o SHA exato READY. Atualizar as evidências sem afirmar configuração visual de Coben até sua definição.

O gate inclui matriz das seis caixas confirmadas e Coben condicional, texto/citação hostis escapados, marca imutável por caixa, pedido legado assinado, e igualdade do conteúdo persistido com os argumentos SMTP. Além dos mocks de chamada, conferir o MIME produzido pela versão fixa da biblioteca para detectar perda de texto, headers duplicados ou corrupção de URLs. Nenhum teste envia e-mail real; validação de HTML/MIME local não comprova aparência em Gmail, Outlook ou outros clientes externos.

## Credenciais por caixa

Manter os secrets globais existentes exclusivamente para `arcade_hub`. Para cada caixa adicional, usar um secret independente `MAILBOX_<ID_MAIUSCULO>_PASS_B64`, onde o ID vem do cadastro permitido pelo servidor. Exemplos: `MAILBOX_CBAI_SOLUTIONS_PASS_B64` e `MAILBOX_LIQUIDA_PECAS_PASS_B64`. O valor é base64 dos bytes UTF-8 da senha, para preservar caracteres especiais no arquivo dotenv; o servidor decodifica antes de autenticar. Base64 não é criptografia. Não aceitar nomes arbitrários de variáveis vindos da requisição.

Para essas contas Hostinger, usuário IMAP, usuário SMTP e remetente são o endereço cadastrado; IMAP e SMTP usam a mesma senha dessa caixa. Os hosts e portas são os confirmados nas referências. Senha ausente desabilita sincronização e envio daquela conta, sem reutilizar a senha da holding. Permissões e metadados ficam no banco; senhas ficam nos secrets das Edge Functions.

O cadastro das seis caixas adicionais foi concluído, com senhas digitadas pelo usuário em terminal local, sem enviá-las no chat. A caixa legada manteve suas credenciais existentes. Para futuras rotações das adicionais, preservar o mesmo procedimento. O helper [configurar-caixas-email.ps1](../../scripts/configurar-caixas-email.ps1) foi preparado com este fluxo:

1. Validar caixa e projeto fixos; coletar senha com `Read-Host -AsSecureString`.
2. Criar diretório temporário fora do repositório com ACL restrita ao usuário atual. Rejeitar senha com CR, LF ou NUL antes de qualquer operação remota; converter a senha válida apenas para gerar um `.env` efêmero com o valor em base64.
3. Usar `supabase@2.121.0 db query` para limpar `imap_verified_at` e `smtp_verified_at` e incrementar `credentials_revision` antes de alterar o secret. Se não existir a caixa ou a operação falhar, abortar sem alterar a senha. Isso evita que uma senha nova herde verificação antiga.
4. Executar o CLI fixado `supabase@2.121.0 secrets set --env-file <arquivo> --project-ref zdwgwpvlwqtsdgervcof --profile <perfil-isolado>`. Não passar a senha como argumento `NAME=VALUE`, imprimir o conteúdo, ativar debug ou salvar em transcript. Depois da tentativa, mesmo se houver erro, limpar novamente os timestamps e incrementar a revisão para invalidar checks iniciados durante o upload. Se essa segunda atualização falhar, avisar que a situação é incerta e pedir nova execução antes de usar a caixa.
5. Em `finally`, apagar o arquivo temporário, liberar a memória BSTR usada na conversão, zerar os bytes e remover referências à senha. O processo precisa de texto em memória temporariamente; `SecureString` não elimina essa etapa.
6. Mostrar apenas sucesso ou erro sanitizado; verificar a conexão depois no dashboard autenticado. Testes de envio externo dependem de autorização e destinatário definidos separadamente.

O suporte a `--env-file` foi confirmado em `secrets set --help`; não se presume suporte a stdin. O helper passou por testes com CLI e entrada simulados: sucesso, falha ao invalidar antes/depois do cadastro, falha ao cadastrar, rejeição de senha com quebra de linha antes de chamar o CLI, preservação de caracteres especiais válidos e limpeza do arquivo temporário. Nenhuma senha real foi coletada ou cadastrada nesses testes.

Uso local para recadastro/rotação solicitada de uma caixa adicional já cadastrada:

```powershell
.\scripts\configurar-caixas-email.ps1 -Mailbox cbai_solutions
```

IDs permitidos: `cbai_solutions`, `jogadaca`, `coben`, `privabr`, `liquida_pecas`, `conferecheck`. `-ProfilePath` permite indicar outro perfil autorizado; o padrão é o perfil local isolado do projeto. Não rotacionar secrets adicionais por fora desse fluxo. `email-check` captura `credentials_revision` ao carregar a conta e atualiza timestamps somente se a revisão continuar igual; atualização sem linha retorna conflito e solicita repetir a verificação.

### Verificação autenticada

`email-check` recebe `{ mailbox_id }`, exige acesso da holding e testa IMAP LOGIN/SELECT e SMTP AUTH com TLS, sem enviar mensagem. Registra resultados independentes e timestamps somente para protocolos autenticados com sucesso. Falha deixa a respectiva capacidade indisponível. A interface oferece a verificação para contas autorizadas mesmo quando suas capacidades de envio/sincronização estão desabilitadas; erros não retornam senha, comando de autenticação ou transcript do servidor.

A caixa legada mantém sua configuração existente e já passou pela verificação equivalente para a prontidão do novo fluxo. O backend não deve executar SMTP MAIL FROM, RCPT TO ou DATA em `email-check`.

## Identidade IMAP e histórico

Manter `uid_imap` no formato existente `INBOX:<uid>` e registrar `imap_uidvalidity` obtido ao selecionar a pasta. A identidade de deduplicação inclui caixa, pasta, UIDVALIDITY e UID; não deduplicar contas diferentes por UID ou `Message-ID` global. O banco deve garantir unicidade dessa identidade contra sincronizações concorrentes. O mecanismo é definido pela [RFC 9051, seção 2.3.1.1](https://www.rfc-editor.org/rfc/rfc9051.html#section-2.3.1.1).

Os registros legados começam com UIDVALIDITY desconhecido. Não preencher todos com o valor atual indiscriminadamente: conferir o UID e o `Message-ID` original antes de reconciliar cada registro, preservando `id`, estado de leitura e corpo em cache. Na primeira execução autenticada, 60 dos 66 recebidos legados tiveram sua época reconciliada por correspondência; seis permaneceram sem época conhecida naquele snapshot. Ausência de correspondência não autoriza sobrescrever o histórico.

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

## Conexão e publicação concluídas

As sete caixas do [inventário atual](../PROJECT_CONTEXT.md) foram verificadas e sincronizadas em 2026-10-15. A identidade legada foi confirmada como `suporte@arcadehub.tech`. Migração aplicada, RLS e Realtime validados, cinco funções publicadas, cron com token dedicado observado em execução e `EMAIL_MULTICAIXAS=true` publicado.

A story 1.3 acrescentou Novo e-mail/Responder/Cancelar e cabeçalhos de conversa, com 30 testes backend, 27 Chrome e 14 verificações remotas negativas. Produção READY nos commits de entrega `1358930` e fechamento `d5ca892`. Nenhuma entrega externa foi testada; não há pendência de cadastrar novamente as sete senhas.

Operação e acesso CLI: [runbook](../runbooks/email-operacao.md). Evidências: [story 1.2](../stories/1.2.story.md), [story 1.3](../stories/1.3.story.md) e [QA](../qa/reviews/1.3-email-envio.md).

## Referências operacionais

- [Hostinger — configuração de contas de e-mail](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/): IMAP `imap.hostinger.com`, SSL, porta 993; SMTP `smtp.hostinger.com`, SSL, porta 465. Confirmar os dados da conta no painel ao configurar.
- [Supabase — secrets de Edge Functions](https://supabase.com/docs/guides/functions/secrets): configuração de segredos no ambiente servidor, sem inseri-los no HTML ou no contrato de discovery.
