import { majorUnits } from "./stripe.ts";

export type StripeAccount = {
  id: string;
  nome: string;
  empresaId: string | null;
  key: string;
  expectedId: string;
};

// The existing holding secret is deliberately kept under its original name.
export function stripeAccounts(
  env = (name: string) => Deno.env.get(name),
): StripeAccount[] {
  const accounts: StripeAccount[] = [{
    id: "arcade_hub",
    nome: "ARCADE HUB TECH",
    empresaId: null,
    key: env("STRIPE_SECRET_KEY") || "",
    expectedId: "acct_1Te0GtHMBfCrtXpm",
  }];
  const key = env("STRIPE_CLICKDROP_SECRET_KEY") || "";
  const expectedId = env("STRIPE_CLICKDROP_ACCOUNT_ID") || "";
  if (key || expectedId) {
    accounts.push({
      id: "clickdrop",
      nome: "ClickDrop",
      empresaId: "clickdrop",
      key,
      expectedId,
    });
  }
  return accounts;
}

export async function verifyStripeAccount(
  account: StripeAccount,
): Promise<void> {
  if (
    account.id !== "arcade_hub" &&
    account.expectedId === "acct_1Te0GtHMBfCrtXpm"
  ) {
    throw new Error("A chave pertence a outra conta Stripe.");
  }
  if (
    !/^(sk|rk)_live_[a-zA-Z0-9]+$/.test(account.key) ||
    !/^acct_[a-zA-Z0-9]+$/.test(account.expectedId)
  ) {
    throw new Error("Credencial ou identificação da conta não configurada.");
  }
  const response = await fetch("https://api.stripe.com/v1/account", {
    headers: { Authorization: `Bearer ${account.key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("O Stripe recusou a verificação da conta.");
  const data = await response.json();
  if (data.id !== account.expectedId) {
    throw new Error("A chave pertence a outra conta Stripe.");
  }
}

type BalanceEntry = { amount: number; currency: string };
export function stripeBalance(
  balance: { available?: BalanceEntry[]; pending?: BalanceEntry[] },
) {
  // Caixa Atual is in reais. Never add a different currency as if it were BRL.
  const sum = (list: BalanceEntry[] = []) =>
    majorUnits(
      list
        .filter((entry) => entry.currency === "brl")
        .reduce((total, entry) => total + Number(entry.amount || 0), 0),
      "brl",
    );
  const disponivel = sum(balance.available);
  const a_liberar = sum(balance.pending);
  return {
    disponivel,
    a_liberar,
    total: Math.round((disponivel + a_liberar) * 100) / 100,
    moeda: "BRL",
  };
}

export function stripeError(error: unknown) {
  // Only our fixed messages may leave the server; never serialize provider errors or keys.
  const allowed = [
    "Credencial ou identificação da conta não configurada.",
    "O Stripe recusou a verificação da conta.",
    "A chave pertence a outra conta Stripe.",
    "O Stripe recusou a lista de cobranças.",
    "O Stripe recusou a consulta de saldo.",
    "Não foi possível gravar os recebimentos.",
    "Não foi possível conferir a origem dos recebimentos.",
    "Recebimento já registrado em outra conta Stripe.",
    "A conta retornou uma cobrança de teste.",
    "A conta retornou um saldo de teste.",
    "Não foi possível consultar o estado da revisão histórica.",
    "Não foi possível registrar a revisão histórica.",
    "O Stripe retornou uma paginação inválida.",
  ];
  return error instanceof Error && allowed.includes(error.message)
    ? error.message
    : "Não foi possível consultar esta conta Stripe.";
}
