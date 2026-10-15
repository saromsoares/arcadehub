import { authenticate, credentials, endpoint, json, type Mailbox, validAddress } from "../_shared/email.ts";
import { emailSignature } from "../_shared/email-signatures.ts";

export const handler = endpoint(async req => {
  const { client } = await authenticate(req);
  const { data, error } = await client.from("email_mailboxes").select("*").eq("enabled", true).order("is_legacy", { ascending: false }).order("label");
  if (error) throw error;
  const accounts = (data as Mailbox[]).map(mailbox => {
    const config = credentials(mailbox);
    const imap = !!(config.imap.password && validAddress(config.imap.user) && mailbox.imap_verified_at);
    const smtp = !!(config.smtp.password && validAddress(config.from) && mailbox.smtp_verified_at);
    const signature = emailSignature(mailbox.id);
    return {
      id: mailbox.id, label: mailbox.label, email: mailbox.email || config.email,
      can_sync: imap, can_send: smtp,
      signature: signature ? { url: signature.url, alt: signature.alt, plainText: signature.plainText } : null,
      status: imap && smtp ? "verified" : config.imap.password && config.smtp.password ? "needs_verification" : "pending_credentials",
    };
  });
  return json({ version: 1, capabilities: { mailbox_scoping: true }, accounts });
});
if (import.meta.main) Deno.serve(handler);
