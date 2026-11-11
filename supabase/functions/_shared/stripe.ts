// Maps a Stripe Charge into the dashboard receipt row. Amounts stay in major
// units (reais). The row never includes empresa_id, so a later sync cannot
// wipe a link the user already chose.

export type StripeCharge = {
  id?: unknown;
  amount?: unknown;
  amount_refunded?: unknown;
  currency?: unknown;
  status?: unknown;
  refunded?: unknown;
  description?: unknown;
  created?: unknown;
  billing_details?: { email?: unknown; name?: unknown } | null;
  payment_method_details?: { type?: unknown } | null;
  balance_transaction?: { fee?: unknown; net?: unknown } | string | null;
};

export type StripeReceipt = {
  stripe_id: string;
  status: string;
  status_detail: string | null;
  tipo_pagamento: string | null;
  descricao: string;
  valor: number;
  valor_liquido: number | null;
  taxa: number | null;
  moeda: string;
  payer_email: string;
  payer_nome: string;
  date_approved: string | null;
  date_created: string | null;
  raw: { id: string; status: string; amount: number; amount_refunded: number; currency: string };
  updated_at: string;
};

const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf",
  "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

function numberOrZero(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function majorUnits(amount: number, currency: string) {
  const scale = ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100;
  return Math.round(amount) / scale;
}

function money(amount: number) {
  return Math.round(amount * 100) / 100;
}

export function mapCharge(charge: StripeCharge, now = new Date()): StripeReceipt | null {
  if (typeof charge?.id !== "string" || !charge.id) return null;
  const currency = typeof charge.currency === "string" && charge.currency ? charge.currency.toLowerCase() : "brl";
  const amount = numberOrZero(charge.amount);
  const refundedAmount = Math.min(amount, Math.max(0, numberOrZero(charge.amount_refunded)));
  const remaining = Math.max(0, amount - refundedAmount);
  const fullyRefunded = charge.refunded === true || (amount > 0 && remaining === 0);
  const partial = refundedAmount > 0 && remaining > 0;
  let status = typeof charge.status === "string" && charge.status ? charge.status : "pending";
  if (charge.status === "failed") status = "rejected";
  else if (fullyRefunded) status = "refunded";
  else if (charge.status === "succeeded") status = "approved";
  else if (charge.status === "pending") status = "pending";
  const ratio = amount > 0 ? remaining / amount : 0;
  const balance = charge.balance_transaction && typeof charge.balance_transaction === "object"
    ? charge.balance_transaction
    : null;
  const fee = balance ? money(majorUnits(numberOrZero(balance.fee), currency) * ratio) : null;
  const net = balance ? money(majorUnits(numberOrZero(balance.net), currency) * ratio) : null;
  const created = numberOrZero(charge.created) > 0 ? new Date(numberOrZero(charge.created) * 1000).toISOString() : null;
  const method = charge.payment_method_details && typeof charge.payment_method_details.type === "string"
    ? charge.payment_method_details.type
    : null;
  return {
    stripe_id: charge.id,
    status,
    status_detail: partial ? "partial_refund" : null,
    tipo_pagamento: method,
    descricao: typeof charge.description === "string" && charge.description.trim() ? charge.description.trim() : "Pagamento Stripe",
    valor: money(majorUnits(fullyRefunded ? 0 : remaining, currency)),
    valor_liquido: fullyRefunded ? 0 : net,
    taxa: fullyRefunded ? 0 : fee,
    moeda: currency.toUpperCase(),
    payer_email: typeof charge.billing_details?.email === "string" ? charge.billing_details.email : "",
    payer_nome: typeof charge.billing_details?.name === "string" ? charge.billing_details.name : "",
    date_approved: status === "approved" ? created : null,
    date_created: created,
    raw: { id: charge.id, status, amount, amount_refunded: refundedAmount, currency },
    updated_at: now.toISOString(),
  };
}
