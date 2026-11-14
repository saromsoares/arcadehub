import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { mapCharge, type StripeCharge } from "../_shared/stripe.ts";
import {
  type StripeAccount,
  stripeAccounts,
  stripeError,
  verifyStripeAccount,
} from "../_shared/stripe-accounts.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sameSecret(expected: string, supplied: string) {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const left = await digest(expected);
  const right = await digest(supplied);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

export const handler = async (req: Request) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "Método não permitido." }, 405);
  }
  const expected = Deno.env.get("STRIPE_SYNC_KEY") || "";
  const supplied = req.headers.get("x-stripe-sync-key") || "";
  if (!expected || !supplied || !(await sameSecret(expected, supplied))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  let full = false;
  try {
    const body = await req.json();
    full = !!body?.full;
  } catch { /* cron calls may send an empty body */ }
  const accounts = stripeAccounts();
  const results = [];
  for (const account of accounts) {
    try {
      await verifyStripeAccount(account);
      const synced = await syncAccount(account, full ? 1000 : 100);
      results.push({ id: account.id, ok: true, synced });
    } catch (error) {
      results.push({
        id: account.id,
        ok: false,
        synced: 0,
        error: stripeError(error),
      });
    }
  }
  const ok = results.every((result) => result.ok);
  return json({
    ok,
    parcial: !ok && results.some((result) => result.ok),
    synced: results.reduce((n, r) => n + r.synced, 0),
    full,
    contas: results,
  }, ok ? 200 : 502);
};

async function syncAccount(account: StripeAccount, maxRecords: number) {
  let synced = 0;
  let startingAfter = "";
  while (synced < maxRecords) {
    const url = new URL("https://api.stripe.com/v1/charges");
    url.searchParams.set("limit", "100");
    url.searchParams.append("expand[]", "data.balance_transaction");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${account.key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("O Stripe recusou a lista de cobranças.");
    const payload = await response.json();
    const charges = Array.isArray(payload.data)
      ? payload.data as StripeCharge[]
      : [];
    if (
      charges.some((charge) =>
        (charge as StripeCharge & { livemode?: boolean }).livemode !== true
      )
    ) {
      throw new Error("A conta retornou uma cobrança de teste.");
    }
    const rows = charges.map((charge) => mapCharge(charge)).filter((row) =>
      row !== null
    );
    if (rows.length) {
      const existing = await supabase.from("stripe_recebimentos").select(
        "stripe_id,raw",
      ).in("stripe_id", rows.map((row) => row.stripe_id));
      if (existing.error) {
        throw new Error("Não foi possível conferir a origem dos recebimentos.");
      }
      if (
        (existing.data || []).some((row) =>
          row.raw?.account_id && row.raw.account_id !== account.expectedId
        )
      ) {
        throw new Error("Recebimento já registrado em outra conta Stripe.");
      }
      for (const row of rows) {
        row.raw.account_id = account.expectedId;
        row.raw.account_source = account.id;
      }
      if (account.empresaId) {
        // Assign only on INSERT. Even a manual unassignment (null) survives future syncs.
        const inserted = await supabase.from("stripe_recebimentos").upsert(
          rows.map((row) => ({ ...row, empresa_id: account.empresaId })),
          { onConflict: "stripe_id", ignoreDuplicates: true },
        );
        if (inserted.error) {
          throw new Error("Não foi possível gravar os recebimentos.");
        }
      }
      const { error } = await supabase.from("stripe_recebimentos").upsert(
        rows,
        { onConflict: "stripe_id" },
      );
      if (error) throw new Error("Não foi possível gravar os recebimentos.");
    }
    synced += charges.length;
    if (!payload.has_more || !charges.length) break;
    const last = charges[charges.length - 1];
    if (!last || typeof last.id !== "string") break;
    startingAfter = last.id;
  }
  return synced;
}

if (import.meta.main) Deno.serve(handler);
