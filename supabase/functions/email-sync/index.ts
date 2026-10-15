import { admin, authorizeMailbox, body, credentials, endpoint, HttpError, isCron, json, type Mailbox, mailboxId } from "../_shared/email.ts";
import { decode, Imap } from "../_shared/mail-connection.ts";
import { decodeWords, getHeader } from "../_shared/mime.js";

export const handler = endpoint(async req => {
  const input = await body(req);
  let mailbox: Mailbox;
  if (await isCron(req)) {
    if (input.mailbox_id === undefined) throw new HttpError(400, "Informe a caixa.");
    const result = await admin.from("email_mailboxes").select("*").eq("id", mailboxId(input.mailbox_id)).eq("enabled", true).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new HttpError(403, "Caixa indisponível.");
    mailbox = result.data;
  } else { mailbox = (await authorizeMailbox(req, input.mailbox_id)).mailbox; }
  if (!mailbox.imap_verified_at) throw new HttpError(409, "Verifique a conexão desta caixa antes de sincronizar.");
  const imap = await Imap.open(credentials(mailbox).imap);
  try {
    const { total, validity } = await imap.select();
    if (!total) return json({ ok: true, total_inbox: 0, novos: 0 });
    const maximum = Math.min(200, Math.max(1, Number(Deno.env.get("IMAP_MAX")) || 60));
    const result = await imap.command(`FETCH ${Math.max(1, total - maximum + 1)}:* (UID FLAGS BODY.PEEK[HEADER.FIELDS (DATE FROM TO SUBJECT MESSAGE-ID)])`);
    let novos = 0;
    for (const literal of result.literals) {
      const uid = literal.meta.match(/\bUID (\d+)/)?.[1];
      if (!uid) throw new Error("Missing IMAP UID");
      const headers = decode(literal.bytes);
      const messageId = getHeader(headers, "Message-ID") || null;
      const uidImap = "INBOX:" + uid;
      // Bind legacy rows only when both UID and Message-ID agree. Keep old history otherwise.
      const legacy = await admin.from("emails").select("id,message_id").eq("mailbox_id", mailbox.id).eq("uid_imap", uidImap).is("imap_uidvalidity", null).maybeSingle();
      if (legacy.error) throw legacy.error;
      if (legacy.data && messageId && legacy.data.message_id === messageId) {
        const adopt = await admin.from("emails").update({ imap_uidvalidity: validity }).eq("id", legacy.data.id).eq("mailbox_id", mailbox.id).is("imap_uidvalidity", null);
        // A parallel sync may already have inserted the new key; don't erase history.
        if (adopt.error && adopt.error.code !== "23505") throw adopt.error;
        if (!adopt.error) continue;
      }
      const date = new Date(getHeader(headers, "Date"));
      const row = {
        mailbox_id: mailbox.id, imap_uidvalidity: validity, uid_imap: uidImap,
        direcao: "in", de: decodeWords(getHeader(headers, "From")), para: decodeWords(getHeader(headers, "To")),
        assunto: decodeWords(getHeader(headers, "Subject")) || "(sem assunto)", status: "recebido", message_id: messageId,
        lido: /\\Seen\b/.test(literal.meta), created_at: isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
      };
      const insert = await admin.from("emails").insert(row);
      if (insert.error && insert.error.code !== "23505") throw insert.error;
      if (!insert.error) novos++;
    }
    return json({ ok: true, total_inbox: total, novos });
  } finally { imap.close(); }
});
if (import.meta.main) Deno.serve(handler);
