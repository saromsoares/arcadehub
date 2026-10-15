import { admin, authorizeMailbox, body, credentials, endpoint, HttpError, json } from "../_shared/email.ts";
import { Imap } from "../_shared/mail-connection.ts";
import { getHeader, parseMessage } from "../_shared/mime.js";

export const handler = endpoint(async req => {
  const input = await body(req);
  const { client, mailbox } = await authorizeMailbox(req, input.mailbox_id);
  if (!/^[1-9]\d*$/.test(String(input.id ?? ""))) throw new HttpError(400, "Mensagem inválida.");
  // UID supplied by the caller is deliberately ignored. RLS also checks this read.
  const result = await client.from("emails").select("id,uid_imap,imap_uidvalidity,message_id,corpo_texto,corpo_html").eq("id", input.id).eq("mailbox_id", mailbox.id).maybeSingle();
  if (result.error) throw result.error;
  const row = result.data;
  if (!row) throw new HttpError(404, "Mensagem não encontrada nesta caixa.");
  if (row.corpo_texto || row.corpo_html) return json({ ok: true, cached: true, corpo_texto: row.corpo_texto || "", corpo_html: row.corpo_html || "" });
  const uid = row.uid_imap?.match(/^INBOX:([1-9]\d*)$/)?.[1];
  if (!uid) throw new HttpError(404, "Corpo indisponível para esta mensagem.");
  const imap = await Imap.open(credentials(mailbox).imap);
  try {
    const { validity } = await imap.select();
    if (row.imap_uidvalidity !== null && String(row.imap_uidvalidity) !== validity) throw new HttpError(409, "A mensagem pertence a um histórico anterior da caixa. Sincronize novamente.");
    const response = await imap.command(`UID FETCH ${uid} (UID BODY.PEEK[])`);
    const literal = response.literals.find(item => item.meta.match(/\bUID (\d+)/)?.[1] === uid);
    if (!literal) throw new HttpError(404, "Mensagem não encontrada na Hostinger.");
    if (row.imap_uidvalidity === null) {
      const headers = new TextDecoder().decode(literal.bytes).split("\r\n\r\n")[0];
      if (!row.message_id || getHeader(headers, "Message-ID") !== row.message_id) throw new HttpError(409, "Não foi possível confirmar a identidade da mensagem antiga.");
    }
    const parsed = parseMessage(literal.bytes);
    const update = await admin.from("emails").update(parsed).eq("id", row.id).eq("mailbox_id", mailbox.id);
    if (update.error) throw update.error;
    return json({ ok: true, cached: false, ...parsed });
  } finally { imap.close(); }
});
if (import.meta.main) Deno.serve(handler);
