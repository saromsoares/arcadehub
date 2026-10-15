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
  const { mailbox, user, client: userClient } = await authorizeMailbox(req, input.mailbox_id);
  if (!mailbox.smtp_verified_at) throw new HttpError(409, "Verifique a conexão desta caixa antes de enviar.");
  const config = credentials(mailbox); requireCredentials(config.smtp);
  if (!validAddress(config.from)) throw new HttpError(409, "Remetente da caixa não configurado.");
  const to = addresses(input.to ?? input.para), cc = addresses(input.cc), bcc = addresses(input.bcc ?? input.cco);
  const subject = text(input.subject ?? input.assunto, 200);
  const content = text(input.text ?? input.texto ?? input.corpo, 50000), html = text(input.html, 100000);
  if (!to.length || !subject || (!content && !html) || /[\r\n]/.test(subject)) throw new HttpError(400, "Preencha destinatário, assunto e mensagem.");
  const messageId = `<${crypto.randomUUID()}@${config.from.split("@")[1].toLowerCase()}>`;
  const headers: Record<string, string> = { "Message-ID": messageId };
  let replyWithoutThread = false;
  if (input.reply_to_id !== undefined) {
    if (!/^[1-9]\d*$/.test(String(input.reply_to_id))) throw new HttpError(400, "Mensagem original inválida.");
    const original = await userClient.from("emails").select("id,message_id").eq("id", input.reply_to_id)
      .eq("mailbox_id", mailbox.id).eq("direcao", "in").maybeSingle();
    if (original.error) throw original.error;
    if (!original.data) throw new HttpError(404, "A mensagem original não está disponível nesta caixa.");
    const parentId = String(original.data.message_id ?? "").trim();
    if (parentId.length <= 900 && /^[\x21-\x7E]+$/.test(parentId) && /^<[^<>\s@]+@[^<>\s@]+>$/.test(parentId)) {
      // denomailer 1.6.0's inReplyTo option emits a misspelled header; use explicit names.
      headers["In-Reply-To"] = parentId;
      headers["References"] = parentId;
    } else { replyWithoutThread = true; }
  }
  // Persist the attempt before SMTP; a database outage must not silently lose a delivery.
  const attempt = await admin.from("emails").insert({
    mailbox_id: mailbox.id, direcao: "out", de: config.from, para: to.join(", "),
    cc: cc.join(", ") || null, cco: bcc.join(", ") || null, assunto: subject,
    corpo_texto: content || null, corpo_html: html || null, status: "pendente", enviado_por: user.id, message_id: messageId,
  }).select("id").single();
  if (attempt.error) throw attempt.error;
  const client = new SMTPClient({ connection: { hostname: config.smtp.host, port: config.smtp.port, tls: true,
    // This library base64-encodes a byte string; preserve UTF-8 passwords as in email-check.
    auth: { username: config.smtp.user, password: Array.from(new TextEncoder().encode(config.smtp.password), byte => String.fromCharCode(byte)).join("") } } });
  let sent = false;
  try {
    await client.send({ from: config.from, to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined,
      subject, content: content || "auto", html: html || undefined, headers });
    sent = true;
  } catch {
    // SMTP can fail after accepting DATA; do not automatically retry this attempt.
    const failed = await admin.from("emails").update({ status: "falha", erro: "Envio não confirmado pela Hostinger. Confira a caixa antes de tentar novamente." }).eq("id", attempt.data.id).eq("mailbox_id", mailbox.id);
    if (failed.error) return json({ ok: false, error: "Envio não confirmado; o histórico também não pôde ser atualizado. Confira a caixa antes de reenviar." }, 502);
    throw new HttpError(502, "Envio não confirmado. Confira a caixa antes de tentar novamente.");
  } finally { try { await client.close(); } catch { /* never override delivery status */ } }
  if (sent) {
    const saved = await admin.from("emails").update({ status: "enviado", erro: null }).eq("id", attempt.data.id).eq("mailbox_id", mailbox.id);
    const warning = saved.error ? "A Hostinger aceitou o e-mail, mas o histórico ficou pendente. Não reenvie." :
      replyWithoutThread ? "Resposta enviada. A mensagem original não possui um identificador válido para agrupar a conversa." : "";
    return json({ ok: true, message_id: messageId, ...(warning ? { warning } : {}) });
  }
  throw new Error("Unexpected SMTP state");
});
if (import.meta.main) Deno.serve(handler);
