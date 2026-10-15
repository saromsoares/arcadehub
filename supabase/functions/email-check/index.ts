import { admin, authorizeMailbox, body, credentials, endpoint, HttpError, json, validAddress } from "../_shared/email.ts";
import { Imap, verifySmtp } from "../_shared/mail-connection.ts";

export const handler = endpoint(async req => {
  const input = await body(req);
  const { mailbox } = await authorizeMailbox(req, input.mailbox_id);
  const config = credentials(mailbox);
  const checks = await Promise.allSettled([
    (async () => { const client = await Imap.open(config.imap); try { await client.select(); } finally { client.close(); } })(),
    (async () => { if (!validAddress(config.from)) throw new Error("invalid from"); await verifySmtp(config.smtp); })(),
  ]);
  const imap = checks[0].status === "fulfilled", smtp = checks[1].status === "fulfilled";
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { imap_verified_at: imap ? now : null, smtp_verified_at: smtp ? now : null };
  if (mailbox.is_legacy && imap && validAddress(config.email)) update.email = config.email;
  const { data, error } = await admin.from("email_mailboxes").update(update).eq("id", mailbox.id).eq("credentials_revision", mailbox.credentials_revision).select("id");
  if (error) throw error;
  if (!data?.length) throw new HttpError(409, "A senha foi alterada durante a verificação. Verifique novamente.");
  return json({ ok: imap && smtp, imap, smtp, email: config.email, smtp_from: config.from,
    message: imap && smtp ? "Recebimento e envio autenticados. Nenhum e-mail foi enviado." : "Não foi possível autenticar todos os serviços. Confira a senha da caixa na Hostinger." });
});
if (import.meta.main) Deno.serve(handler);
