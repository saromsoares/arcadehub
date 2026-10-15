# E-mail multicaixas — contrato proposto

Status: preparação local. Este documento define o contrato esperado pela interface; não confirma funções publicadas, migração aplicada ou contas Hostinger conectadas. A integração remota atual não pôde ser inspecionada por falta de acesso ao projeto Supabase.

## Ativação e compatibilidade

`EMAIL_MULTICAIXAS = false` preserva a caixa existente e as chamadas legadas, sem consultar discovery. A interface usa um nome genérico para essa caixa porque seu endereço efetivamente sincronizado ainda precisa ser confirmado.

Somente habilitar a flag depois de validar o backend, as permissões e as contas. Quando habilitada, qualquer erro de discovery ou contrato inválido bloqueia a operação multicaixas e apresenta a falha. Não há fallback automático para credenciais ou chamadas legadas.

## Discovery

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

1. Recuperar acesso ao projeto Supabase e inspecionar as funções e o esquema existentes.
2. Verificar as contas confirmadas acima na Hostinger e configurar suas credenciais e autorizações no servidor.
3. Adaptar e validar discovery, sincronização, leitura do corpo e envio; manter credenciais exclusivamente no servidor.
4. Vincular o histórico à caixa correta, garantir isolamento dos identificadores IMAP entre contas e aplicar autorização no banco e nas funções.
5. Validar recebimento, sincronização e autorização de envio em cada caixa antes de habilitar a flag em produção. Os testes desta implementação não enviam mensagens reais.

Mocks no navegador devem cobrir legado, duas caixas, nenhuma conta, discovery negado ou inválido, troca durante carregamento/envio e logout durante leitura. Eles verificam a interface e o contrato proposto, sem comprovar autenticação Hostinger ou entrega de e-mail.

## Referências operacionais

- [Hostinger — configuração de contas de e-mail](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/): IMAP `imap.hostinger.com`, SSL, porta 993; SMTP `smtp.hostinger.com`, SSL, porta 465. Confirmar os dados da conta no painel ao configurar.
- [Supabase — secrets de Edge Functions](https://supabase.com/docs/guides/functions/secrets): configuração de segredos no ambiente servidor, sem inseri-los no HTML ou no contrato de discovery.
