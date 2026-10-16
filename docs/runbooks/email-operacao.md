# Operação das caixas de e-mail

Estado validado em 2026-10-15. Inventário: [contexto do projeto](../PROJECT_CONTEXT.md). Este documento não contém credenciais.

## Uso no dashboard

Em `https://arcadehub.tech/admin/`, entrar com a conta autorizada da holding, abrir E-mail e selecionar a caixa. **Verificar conexão** testa IMAP e SMTP sem enviar mensagem; **Sincronizar** importa cabeçalhos recentes; **Abrir** carrega o corpo. **Novo e-mail** começa vazio; **Responder** preenche destinatário, assunto e contexto; **Cancelar** confirma descarte quando existe rascunho. Conferir o campo **De** antes de enviar.

Cada operação usa a identidade da caixa selecionada. `mailbox_id` não é necessariamente o ID da empresa financeira: `coben` difere de `coben_life_os`, e `privabr` difere de `priva_br`. A lista é obtida por `email-accounts`, não pelo array `COMPANIES`.

## Assinaturas publicadas

As sete caixas têm assinatura visual automática e prévia no compositor. Arcade e CBAI compartilham a mesma arte por decisão do usuário; Coben usa coben.png desde a atualização incremental de 2026-10-15. Seis PNG públicos ficam em `assets/email-signatures/`; o mapa autorizado fica em `supabase/functions/_shared/email-signatures.ts`. A imagem não é adicionada ao textarea: o servidor monta texto novo, identificação textual/imagem e histórico separado (`quoted_text`), preservando `reply_to_id` e os cabeçalhos da conversa.

Uma arte nova deve estar pública antes de ativar seu mapa no backend e frontend. A sequência observada foi `c8edc14` → `d0fcf06` → `372ec6d` para a entrega inicial e `ebcee73` → deploy accounts/send → `00fe18e` para Coben. O último código foi confirmado READY e admin HTTP 200. URLs antigas devem continuar acessíveis para mensagens já enviadas. Em 2026-10-16 a suíte Deno passou 31/31, incluindo composição SMTP/MIME simulada sem rede ou e-mails reais. A conferência interativa do dashboard autenticado e a renderização em clientes de e-mail ainda não foram verificadas.

## Acesso técnico já configurado

O CLI 2.121.0 conseguiu acessar o projeto mesmo quando o conector não autorizava a operação. O perfil isolado preserva o login padrão de outros projetos. Usar os caminhos locais existentes, sem imprimir seu conteúdo:

```powershell
$env:SUPABASE_HOME = 'C:/Workspace/arcadehub/.aiox/supabase-cli-home'
$arcadeProfile = 'C:/Workspace/arcadehub/.aiox/supabase-arcadehub-profile.yaml'
npx --yes supabase@2.121.0 projects list --profile $arcadeProfile
```

Esses arquivos são locais/ignorados; um checkout novo não contém a sessão. Só iniciar novo login se a sessão realmente não funcionar. O limite de 20 personal access tokens já foi encontrado e resolvido nesta sessão; não gerar repetidamente novos tokens. A publishable key identifica o projeto no frontend, mas não substitui login de usuário, PAT ou credencial de banco.

## Trocar a senha de uma caixa

As sete contas já estão verificadas. Para uma troca solicitada nas seis adicionais:

```powershell
.\scripts\configurar-caixas-email.ps1 -Mailbox cbai_solutions
```

O assistente usa `Read-Host -AsSecureString`, arquivo temporário com ACL restrita e limpeza em `finally`. Para várias contas, `scripts/conectar-emails.ps1` permite pular com Enter. Usar senha da caixa/webmail, não a senha de acesso ao painel Hostinger; nunca colar senha no chat ou salvá-la em documentação.

O helper limpa verificações e incrementa `credentials_revision` antes/depois de mudar `MAILBOX_<ID_MAIUSCULO>_PASS_B64`. Base64 preserva bytes UTF-8, não criptografa a senha. Depois selecionar a caixa no dashboard, **Verificar conexão** e **Sincronizar**. Não substituir secrets diretamente por fora desse procedimento. A caixa legada usa configuração global existente e não está na lista do helper das adicionais.

## Publicar alteração de função

Executar apenas para código alterado, revisado e autorizado; o push do site não publica Edge Functions. Exemplo do comando usado na story 1.3:

```powershell
npx --yes supabase@2.121.0 functions deploy email-send --use-api --no-verify-jwt --project-ref zdwgwpvlwqtsdgervcof --profile $arcadeProfile
```

Os handlers validam usuário e RLS internamente; preservar isso junto de `verify_jwt=false`. `email-sync` aceita adicionalmente o token de cron. Publicar backend antes do frontend que dependa do novo contrato. Confirmar disponibilidade sem provocar entrega externa.

## Banco e cron

Migração multicaixas `20261015182925` aplicada/registrada. Não reaplicá-la como instalação nova nem usar `db push` sem conciliar histórico. O rollback estrutural tem guards e **não serve após importação de caixas adicionais**, situação atual.

Job 3 `email-sync-incremental`: `*/3 * * * *`, token vindo do Vault `email_sync_cron_token`, header `x-email-cron-token`, secret servidor `EMAIL_SYNC_CRON_TOKEN`. Não imprimir valores. Após pausa/deploy, conferir explicitamente `active=true`: atualizar job nomeado com `cron.schedule` pode preservar o estado pausado. Confirmar execução e HTTP da chamada, pois execução SQL do cron sozinha não comprova sucesso da função.

## Validação e diagnóstico

```powershell
npx --yes deno test --config supabase/deno.json --allow-env supabase/tests/email-functions_test.ts
npx --yes deno check --config supabase/deno.json supabase/functions/email-send/index.ts
```

A suite usa SMTP/TLS e HTTP simulados sem permissão de rede. Navegador deve cobrir sete remetentes, `reply_to_id`, descarte, falhas, logout, concorrência, mobile e console. Checks remotos negativos podem confirmar 401/403/400/404 sem envio; remover fixtures temporárias e conferir ausência de tentativas de saída. Testes positivos reais exigem intenção de envio e destinatário definidos pelo usuário.

- `401`: verificar sessão autenticada; publishable key sozinha não autentica o usuário.
- `403`: verificar membership da holding e caixa habilitada; não contornar RLS com chave privilegiada no frontend.
- `409`/caixa pendente: executar **Verificar conexão**, revisar credencial e revisão antes de tentar enviar.
- `404` ao responder: original precisa existir na mesma caixa e ser recebido; não reenviar como mensagem nova automaticamente.
- Aceito pelo SMTP com histórico pendente: a interface avisa **Não reenvie**. Conferir caixa/histórico antes de qualquer ação manual.
- Falha após DATA pode ser ambígua; não adicionar retry automático que duplique entrega.

Denomailer 1.6.0 escreve `InReplyTo` incorreto na opção `inReplyTo`. A implementação usa headers explícitos `In-Reply-To` e `References`; não trocar sem testar os bytes SMTP. `Message-ID` novo deve coincidir entre histórico e mensagem transmitida. AUTH LOGIN converte senha para bytes UTF-8, compatíveis com o check SMTP.
