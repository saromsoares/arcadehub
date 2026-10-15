import { createClient } from "npm:@supabase/supabase-js@2.117.0";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
export function endpoint(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);
    try { return await handler(req); }
    catch (error) {
      // Provider errors can contain authentication commands or message contents.
      return json({ ok: false, error: error instanceof HttpError ? error.message : "Não foi possível concluir a operação de e-mail." }, error instanceof HttpError ? error.status : 502);
    }
  };
}
export async function body(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (!raw) return {};
  if (raw.length > 170000) throw new HttpError(413, "Pedido muito grande.");
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, "Pedido inválido."); }
}
export async function authenticate(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) throw new HttpError(401, "Entre novamente no dashboard.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Entre novamente no dashboard.");
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user: data.user, client };
}
export type Mailbox = {
  id: string; email: string | null; label: string; enabled: boolean; is_legacy: boolean;
  imap_verified_at: string | null; smtp_verified_at: string | null;
  credentials_revision: number;
};
export function mailboxId(value: unknown) {
  // Only omission selects the legacy mailbox. Invalid/empty IDs never fall back.
  if (value === undefined) return "arcade_hub";
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new HttpError(400, "Caixa inválida.");
  return value;
}
export async function authorizeMailbox(req: Request, value: unknown) {
  const auth = await authenticate(req);
  const { data, error } = await auth.client.from("email_mailboxes").select("*").eq("id", mailboxId(value)).eq("enabled", true).maybeSingle();
  if (error) throw new HttpError(503, "Não foi possível verificar as permissões da caixa.");
  if (!data) throw new HttpError(403, "Você não tem acesso a esta caixa.");
  return { ...auth, mailbox: data as Mailbox };
}
export const validAddress = (value: string) => /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value);
export function credentials(mailbox: Mailbox) {
  const legacy = mailbox.is_legacy && mailbox.id === "arcade_hub";
  let password = "";
  if (!legacy) {
    const encoded = Deno.env.get(`MAILBOX_${mailbox.id.toUpperCase()}_PASS_B64`) || "";
    if (encoded) {
      try { password = new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))); }
      catch { throw new HttpError(503, "Configuração da caixa inválida."); }
    }
  }
  const smtpUser = legacy ? (Deno.env.get("SMTP_USER") || "").trim() : mailbox.email || "";
  const imapUser = legacy ? (Deno.env.get("IMAP_USER") || smtpUser).trim() : smtpUser;
  return {
    imap: { host: legacy ? Deno.env.get("IMAP_HOST") || "imap.hostinger.com" : "imap.hostinger.com", port: legacy ? Number(Deno.env.get("IMAP_PORT") || 993) : 993, user: imapUser, password: legacy ? Deno.env.get("IMAP_PASS") || Deno.env.get("SMTP_PASS") || "" : password },
    smtp: { host: legacy ? Deno.env.get("SMTP_HOST") || "smtp.hostinger.com" : "smtp.hostinger.com", port: legacy ? Number(Deno.env.get("SMTP_PORT") || 465) : 465, user: smtpUser, password: legacy ? Deno.env.get("SMTP_PASS") || "" : password },
    from: legacy ? (Deno.env.get("SMTP_FROM") || smtpUser).trim() : smtpUser,
    email: imapUser,
  };
}
export type Connection = { host: string; port: number; user: string; password: string };
export function requireCredentials(connection: Connection) {
  if (!validAddress(connection.user) || !connection.password || /[\r\n\0]/.test(connection.password)) throw new HttpError(409, "Configure a senha desta caixa da Hostinger.");
}
export async function isCron(req: Request) {
  const expected = Deno.env.get("EMAIL_SYNC_CRON_TOKEN");
  const supplied = req.headers.get("x-email-cron-token");
  if (!expected || !supplied) return false;
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const a = await digest(expected), b = await digest(supplied);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
