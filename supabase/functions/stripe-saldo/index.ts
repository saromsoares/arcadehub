import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import {
  stripeAccounts,
  stripeBalance,
  stripeError,
  verifyStripeAccount,
} from "../_shared/stripe-accounts.ts";
import { majorUnits } from "../_shared/stripe.ts";

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
  return data.user.id;
}

export const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ ok: false, error: "Método não permitido." }, 405);
  }
  const denied = await requireHolding(req);
  if (denied instanceof Response) return denied;
  const page = await admin.from("usuarios_paginas_bloqueadas").select("paginas")
    .eq("user_id", denied).maybeSingle();
  // Failure to verify details is not permission to disclose individual accounts.
  const showDetails = !page.error &&
    !(page.data?.paginas || []).includes("stripe");
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
          origem: "api",
          atualizado_em: null,
          saldo_referencia_em: null,
          desatualizado: false,
          consultado_em: new Date().toISOString(),
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
      ...(showDetails ? { contas } : {}),
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
  const historico: unknown[] = [];
  const liberacoes: {
    conta_id: string;
    data: string;
    valor: number;
    moeda: string;
    recebimentos: number;
  }[] = [];
  let historicoErro: string | null = null, liberacoesErro: string | null = null;
  const movimentos: {
    conta_id: string;
    id: string;
    tipo: string;
    valor: number;
    taxa: number;
    liquido: number;
    moeda: string;
    status: string;
    data: string;
  }[] = [];
  let movimentosErro: string | null = null;
  const movimentosContas: {
    conta_id: string;
    has_more: boolean | null;
    ok: boolean;
  }[] = [];
  if (showDetails) {
    await Promise.all(
      stripeAccounts().map(async (account) => {
        if (!valid.some((item) => item.id === account.id)) return;
        try {
          const response = await fetch(
            "https://api.stripe.com/v1/balance_transactions?limit=100",
            {
              headers: { Authorization: `Bearer ${account.key}` },
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!response.ok) throw new Error("statement unavailable");
          const statement = await response.json();
          if (
            !Array.isArray(statement.data) ||
            typeof statement.has_more !== "boolean"
          ) {
            throw new Error("statement malformed");
          }
          const safe = statement.data.slice(0, 100).map(
            (row: Record<string, unknown>) => {
              if (
                typeof row.id !== "string" ||
                !/^txn_[A-Za-z0-9]+$/.test(row.id) ||
                typeof row.type !== "string" || !/^[a-z_]+$/.test(row.type) ||
                typeof row.currency !== "string" ||
                !/^[a-z]{3}$/.test(row.currency) ||
                !["available", "pending"].includes(String(row.status)) ||
                !Number.isSafeInteger(row.amount) ||
                !Number.isSafeInteger(row.fee) ||
                !Number.isSafeInteger(row.net) ||
                !Number.isSafeInteger(row.created) ||
                Number(row.created) <= 0 || Number(row.created) > 8640000000000
              ) {
                throw new Error("statement malformed");
              }
              return {
                conta_id: account.id,
                id: row.id,
                tipo: row.type,
                valor: majorUnits(Number(row.amount), row.currency),
                taxa: majorUnits(Number(row.fee), row.currency),
                liquido: majorUnits(Number(row.net), row.currency),
                moeda: row.currency.toUpperCase(),
                status: String(row.status),
                data: new Date(Number(row.created) * 1000).toISOString(),
              };
            },
          );
          movimentos.push(...safe);
          movimentosContas.push({
            conta_id: account.id,
            has_more: statement.has_more,
            ok: true,
          });
        } catch {
          movimentosErro =
            "Não foi possível consultar todos os movimentos do Stripe.";
          movimentosContas.push({
            conta_id: account.id,
            has_more: null,
            ok: false,
          });
        }
      }),
    );
    movimentos.sort((a, b) =>
      b.data.localeCompare(a.data) || a.id.localeCompare(b.id)
    );
    const state = await admin.from("stripe_sync_state").select(
      "account_key,account_id,full_started_at,full_completed_at,last_checked_at,error_sanitized,reviewed_count,cursor_full",
    );
    if (state.error) {
      historicoErro = "Não foi possível consultar a cobertura histórica.";
    } else {historico.push(...(state.data || []).map((row) => ({
        ...row,
        em_andamento: !!row.full_started_at &&
          (!row.full_completed_at ||
            row.full_started_at > row.full_completed_at),
        completo: !!row.full_completed_at &&
          (!row.full_started_at ||
            row.full_completed_at >= row.full_started_at),
      })
      ));}
    const receipts = await admin.from("stripe_recebimentos").select(
      "stripe_id,valor_liquido,moeda,raw",
    )
      .eq("status", "approved").eq("moeda", "BRL").eq(
        "raw->>balance_status",
        "pending",
      ).limit(1000);
    if (receipts.error) {
      liberacoesErro =
        "Não foi possível consultar as datas de liberação conhecidas.";
    } else {
      for (const row of receipts.data || []) {
        const account = contas.find((a) =>
          a.ok && a.account_id === row.raw?.account_id
        );
        const time = Date.parse(String(row.raw?.available_on || ""));
        const net = Number(row.valor_liquido);
        if (
          !account || !Number.isFinite(time) || row.valor_liquido === null ||
          !Number.isFinite(net)
        ) continue;
        const date = new Date(time).toISOString().slice(0, 10);
        let release = liberacoes.find((item) =>
          item.conta_id === account.id && item.data === date
        );
        if (!release) {
          release = {
            conta_id: account.id,
            data: date,
            valor: 0,
            moeda: "BRL",
            recebimentos: 0,
          };
          liberacoes.push(release);
        }
        release.valor = Math.round((release.valor + net) * 100) / 100;
        release.recebimentos++;
      }
      liberacoes.sort((a, b) => a.data.localeCompare(b.data));
    }
  }
  return json({
    ok: true,
    saldo_ok: true,
    parcial: valid.length !== contas.length,
    conta: {
      nome: showDetails
        ? valid.map((account) => account.nome).join(" + ")
        : "Stripe",
    },
    ...(showDetails
      ? {
        contas,
        historico,
        historico_erro: historicoErro,
        movimentos,
        movimentos_erro: movimentosErro,
        movimentos_cobertura: {
          completa: false,
          limite_por_conta: 100,
          fonte: "balance_transactions",
          contas: movimentosContas,
          aviso:
            "Até 100 movimentos recentes por conta; não constitui extrato histórico completo nem soma de vendas.",
        },
        liberacoes,
        liberacoes_erro: liberacoesErro,
        liberacoes_cobertura: {
          completa: false,
          fonte: "cobrancas_sincronizadas",
          aviso:
            "Datas de disponibilidade de cobranças conhecidas; ajustes, taxas, estornos e repasses podem divergir do saldo a liberar. Não representam data de repasse bancário.",
        },
      }
      : {}),
    saldo: {
      disponivel,
      a_liberar,
      total: Math.round((disponivel + a_liberar) * 100) / 100,
      moeda: "BRL",
    },
    consultado_em: new Date().toISOString(),
    atualizado_em: null,
    saldo_referencia_em: null,
    origem: "api",
    desatualizado: false,
  });
};

if (import.meta.main) Deno.serve(handler);
