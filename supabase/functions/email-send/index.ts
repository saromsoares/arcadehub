import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { admin, authorizeMailbox, body, credentials, endpoint, HttpError, json, requireCredentials, validAddress } from "../_shared/email.ts";

const text = (value: unknown, maximum: number) => String(value ?? "").trim().slice(0, maximum);
function addresses(value: unknown) {
  const list = text(value, 2000).split(/[;,]/).map(s => s.trim()).filter(Boolean);
  if (list.length > 25 || list.some(s => !validAddress(s))) throw new HttpError(400, "Confira os endereços dos destinatários.");
  return list;
}
export const handler = endpoint(async req => {
  const input = await body(req);
  const { mailbox, user } = await authorizeMailbox(req, input.mailbox_id);
  if (!mailbox.smtp_verified_at) throw new HttpError(409, "Verifique a conexão desta caixa antes de enviar.");
  const config = credentials(mailbox); requireCredentials(config.smtp);
  if (!validAddress(config.from)) throw new HttpError(409, "Remetente da caixa não configurado.");
  const to = addresses(input.to ?? input.para), cc = addresses(input.cc), bcc = addresses(input.bcc ?? input.cco);
  const subject = text(input.subject ?? input.assunto, 200);
  const content = text(input.text ?? input.texto ?? input.corpo, 50000), html = text(input.html, 100000);
  if (!to.length || !subject || (!content && !html) || /[\r\n]/.test(subject)) throw new HttpError(400, "Preencha destinatário, assunto e mensagem.");
  // Persist the attempt before SMTP; a database outage must not silently lose a delivery.
  const attempt = await admin.from("emails").insert({
    mailbox_id: mailbox.id, direcao: "out", de: config.from, para: to.join(", "),
    cc: cc.join(", ") || null, cco: bcc.join(", ") || null, assunto: subject,
    corpo_texto: content || null, corpo_html: html || null, status: "pendente", enviado_por: user.id,
  }).select("id").single();
  if (attempt.error) throw attempt.error;
  const client = new SMTPClient({ connection: { hostname: config.smtp.host, port: config.smtp.port, tls: true,
    auth: { username: config.smtp.user, password: config.smtp.password } } });
  let sent = false;
  try {
    await client.send({ from: config.from, to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined,
      subject, content: content || "auto", html: html || undefined });
    sent = true;
  } catch {
    // SMTP can fail after accepting DATA; do not automatically retry this attempt.
    const failed = await admin.from("emails").update({ status: "falha", erro: "Envio não confirmado pela Hostinger. Confira a caixa antes de tentar novamente." }).eq("id", attempt.data.id).eq("mailbox_id", mailbox.id);
    if (failed.error) return json({ ok: false, error: "Envio não confirmado; o histórico também não pôde ser atualizado. Confira a caixa antes de reenviar." }, 502);
    throw new HttpError(502, "Envio não confirmado. Confira a caixa antes de tentar novamente.");
  } finally { try { await client.close(); } catch { /* never override delivery status */ } }
  if (sent) {
    const saved = await admin.from("emails").update({ status: "enviado", erro: null }).eq("id", attempt.data.id).eq("mailbox_id", mailbox.id);
    return json({ ok: true, ...(saved.error ? { warning: "A Hostinger aceitou o e-mail, mas o histórico ficou pendente. Não reenvie." } : {}) });
  }
  throw new Error("Unexpected SMTP state");
});
if (import.meta.main) Deno.serve(handler);
