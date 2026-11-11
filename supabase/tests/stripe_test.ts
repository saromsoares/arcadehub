import assert from "node:assert/strict";
import { majorUnits, mapCharge } from "../functions/_shared/stripe.ts";

Deno.test("converte centavos de real para reais", () => {
  assert.equal(majorUnits(10050, "brl"), 100.5);
  assert.equal(majorUnits(1000, "jpy"), 1000);
});

Deno.test("mapeia cobrança aprovada com taxa e líquido", () => {
  const row = mapCharge({
    id: "ch_ok",
    amount: 10000,
    amount_refunded: 0,
    currency: "brl",
    status: "succeeded",
    description: "Assinatura",
    created: 1762826400,
    billing_details: { email: "ana@exemplo.com", name: "Ana" },
    payment_method_details: { type: "card" },
    balance_transaction: { fee: 390, net: 9610 },
  }, new Date("2026-11-11T12:00:00Z"));
  assert.ok(row);
  assert.equal(row.stripe_id, "ch_ok");
  assert.equal(row.status, "approved");
  assert.equal(row.valor, 100);
  assert.equal(row.taxa, 3.9);
  assert.equal(row.valor_liquido, 96.1);
  assert.equal(row.moeda, "BRL");
  assert.equal(row.payer_email, "ana@exemplo.com");
  assert.equal(row.tipo_pagamento, "card");
  assert.equal(row.date_approved, row.date_created);
  assert.equal("empresa_id" in row, false);
});

Deno.test("estorno integral não entra como receita", () => {
  const row = mapCharge({ id: "ch_back", amount: 5000, amount_refunded: 5000, currency: "brl", status: "succeeded", refunded: true, created: 1762826400 });
  assert.equal(row?.status, "refunded");
  assert.equal(row?.valor, 0);
  assert.equal(row?.date_approved, null);
});

Deno.test("estorno parcial reduz o valor que sobra", () => {
  const row = mapCharge({
    id: "ch_part",
    amount: 10000,
    amount_refunded: 2500,
    currency: "brl",
    status: "succeeded",
    created: 1762826400,
    balance_transaction: { fee: 400, net: 9600 },
  });
  assert.equal(row?.status, "approved");
  assert.equal(row?.status_detail, "partial_refund");
  assert.equal(row?.valor, 75);
  assert.equal(row?.taxa, 3);
  assert.equal(row?.valor_liquido, 72);
});

Deno.test("cobrança sem id é ignorada", () => {
  assert.equal(mapCharge({ amount: 100 }), null);
});
