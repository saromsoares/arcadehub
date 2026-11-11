import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { mapCharge, type StripeCharge } from "../_shared/stripe.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

async function sameSecret(expected: string, supplied: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const left = await digest(expected);
  const right = await digest(supplied);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) difference |= (left[index] || 0) ^ (right[index] || 0);
  return difference === 0;
}

export const handler = async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);
  const expected = Deno.env.get("STRIPE_SYNC_KEY") || "";
  const supplied = req.headers.get("x-stripe-sync-key") || "";
  if (!expected || !supplied || !(await sameSecret(expected, supplied))) return json({ ok: false, error: "unauthorized" }, 401);
  const key = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!key) return json({ ok: false, error: "A chave do Stripe ainda não foi configurada no servidor." }, 503);
  let full = false;
  try {
    const body = await req.json();
    full = !!body?.full;
  } catch { /* cron calls may send an empty body */ }
  const maxRecords = full ? 1000 : 100;
  let synced = 0;
  let startingAfter = "";
  try {
    while (synced < maxRecords) {
      const url = new URL("https://api.stripe.com/v1/charges");
      url.searchParams.set("limit", "100");
      url.searchParams.append("expand[]", "data.balance_transaction");
      if (startingAfter) url.searchParams.set("starting_after", startingAfter);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!response.ok) return json({ ok: false, error: "O Stripe recusou a lista de cobranças." }, 502);
      const payload = await response.json();
      const charges = Array.isArray(payload.data) ? payload.data as StripeCharge[] : [];
      const rows = charges.map(charge => mapCharge(charge)).filter(row => row !== null);
      if (rows.length) {
        const { error } = await supabase.from("stripe_recebimentos").upsert(rows, { onConflict: "stripe_id" });
        if (error) return json({ ok: false, error: "Não foi possível gravar os recebimentos." }, 500);
      }
      synced += charges.length;
      if (!payload.has_more || !charges.length) break;
      const last = charges[charges.length - 1];
      if (!last || typeof last.id !== "string") break;
      startingAfter = last.id;
    }
    return json({ ok: true, synced, full });
  } catch {
    return json({ ok: false, error: "Não foi possível sincronizar o Stripe." }, 502);
  }
};

if (import.meta.main) Deno.serve(handler);
