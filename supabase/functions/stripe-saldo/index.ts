import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import {
  stripeAccounts,
  stripeBalance,
  stripeError,
  verifyStripeAccount,
} from "../_shared/stripe-accounts.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-stripe-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

async function requireHolding(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) {
    return json({ ok: false, error: "Entre novamente no dashboard." }, 401);
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return json({ ok: false, error: "Entre novamente no dashboard." }, 401);
  }
  const access = await admin.from("usuarios_empresas").select("empresa_id").eq(
    "user_id",
    data.user.id,
  ).eq("empresa_id", "arcade_hub").maybeSingle();
  if (access.error) {
    return json(
      { ok: false, error: "Não foi possível verificar o acesso." },
      503,
    );
  }
  if (!access.data) {
    return json({ ok: false, error: "A conta Stripe é da holding." }, 403);
  }
  return null;
}

export const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ ok: false, error: "Método não permitido." }, 405);
  }
  const denied = await requireHolding(req);
  if (denied) return denied;
  const contas = await Promise.all(
    stripeAccounts().map(async (account) => {
      const identity = {
        id: account.id,
        nome: account.nome,
        empresa_id: account.empresaId,
        account_id: account.expectedId,
      };
      try {
        await verifyStripeAccount(account);
        const response = await fetch("https://api.stripe.com/v1/balance", {
          headers: { Authorization: `Bearer ${account.key}` },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          throw new Error("O Stripe recusou a consulta de saldo.");
        }
        const balance = await response.json();
        if (balance.livemode !== true) {
          throw new Error("A conta retornou um saldo de teste.");
        }
        return {
          ...identity,
          ok: true as const,
          saldo: stripeBalance(balance),
        };
      } catch (error) {
        return { ...identity, ok: false as const, error: stripeError(error) };
      }
    }),
  );
  const valid = contas.filter((account) => account.ok);
  if (!valid.length) {
    return json({
      ok: false,
      saldo_ok: false,
      error: "Não foi possível consultar o Stripe.",
      contas,
    }, 502);
  }
  const sum = (field: "disponivel" | "a_liberar") =>
    Math.round(
      valid.reduce(
        (total, account) => total + (account.saldo?.[field] || 0),
        0,
      ) * 100,
    ) / 100;
  const disponivel = sum("disponivel"), a_liberar = sum("a_liberar");
  return json({
    ok: true,
    saldo_ok: true,
    parcial: valid.length !== contas.length,
    conta: { nome: valid.map((account) => account.nome).join(" + ") },
    contas,
    saldo: {
      disponivel,
      a_liberar,
      total: Math.round((disponivel + a_liberar) * 100) / 100,
      moeda: "BRL",
    },
    consultado_em: new Date().toISOString(),
  });
};

if (import.meta.main) Deno.serve(handler);
