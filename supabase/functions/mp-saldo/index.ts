import { createClient } from "npm:@supabase/supabase-js@2.117.0";

const MP_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
let relatorioPedidoEm = 0;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

function numeroMercadoPago(valor: unknown): number | null {
  const n = typeof valor === "number"
    ? valor
    : typeof valor === "string"
    ? parseFloat(valor)
    : NaN;
  return Number.isFinite(n) ? n : null;
}

function lerSaldoMercadoPago(corpo: unknown) {
  if (!corpo || typeof corpo !== "object") return null;
  const bruto = corpo as Record<string, unknown>;
  const fonte = bruto.data && typeof bruto.data === "object"
    ? bruto.data as Record<string, unknown>
    : bruto;
  const disponivel = numeroMercadoPago(
    fonte.available_balance ?? fonte.available ?? fonte.availableBalance,
  );
  const pendente = numeroMercadoPago(
    fonte.unavailable_balance ?? fonte.unavailable ??
      fonte.unavailableBalance ?? fonte.pending,
  );
  let total = numeroMercadoPago(
    fonte.total_amount ?? fonte.total ?? fonte.totalBalance,
  );
  if (total === null && (disponivel !== null || pendente !== null)) {
    total = (disponivel ?? 0) + (pendente ?? 0);
  }
  if (disponivel === null && total === null) return null;
  return {
    available_balance: disponivel,
    unavailable_balance: pendente,
    total_amount: total,
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizarCabecalho(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function numeroPlanilha(valor: string): number | null {
  const bruto = String(valor ?? "").trim().replace(/\s/g, "").replace("R$", "");
  if (!bruto || bruto === "-" || bruto === "—") return null;
  const negativo = bruto.startsWith("-") || /^\(.*\)$/.test(bruto);
  const limpo = bruto.replace(/[()]/g, "").replace(/^-/, "");
  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");
  let texto = limpo;
  if (ultimaVirgula >= 0 && ultimoPonto >= 0) {
    texto = ultimaVirgula > ultimoPonto
      ? limpo.replace(/\./g, "").replace(",", ".")
      : limpo.replace(/,/g, "");
  } else if (ultimaVirgula >= 0) {
    texto = limpo.length - ultimaVirgula - 1 === 3
      ? limpo.replace(/,/g, "")
      : limpo.replace(",", ".");
  } else if (
    ultimoPonto >= 0 && limpo.length - ultimoPonto - 1 === 3 &&
    limpo.split(".").length === 2
  ) {
    texto = limpo.replace(/\./g, "");
  }
  const n = Number(texto);
  if (!Number.isFinite(n)) return null;
  return negativo ? -Math.abs(n) : n;
}

function separarCsv(texto: string): string[][] {
  const fonte = texto.replace(/^\uFEFF/, "");
  const primeira = fonte.split(/\r?\n/, 1)[0] ?? "";
  let fora = true;
  let virgulas = 0;
  let pontoEVirgula = 0;
  for (const c of primeira) {
    if (c === '"') fora = !fora;
    else if (fora && c === ",") virgulas++;
    else if (fora && c === ";") pontoEVirgula++;
  }
  const separador = pontoEVirgula > virgulas ? ";" : ",";
  const linhas: string[][] = [];
  let celula = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < fonte.length; i++) {
    const c = fonte[i];
    if (aspas) {
      if (c === '"') {
        if (fonte[i + 1] === '"') {
          celula += '"';
          i++;
        } else aspas = false;
      } else celula += c;
      continue;
    }
    if (c === '"') {
      aspas = true;
      continue;
    }
    if (c === separador) {
      linha.push(celula);
      celula = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && fonte[i + 1] === "\n") i++;
      linha.push(celula);
      if (linha.some((item) => item.trim() !== "")) linhas.push(linha);
      linha = [];
      celula = "";
      continue;
    }
    celula += c;
  }
  linha.push(celula);
  if (linha.some((item) => item.trim() !== "")) linhas.push(linha);
  return linhas;
}

function saldoDoRelatorio(csv: string): number | null {
  const linhas = separarCsv(csv);
  if (linhas.length < 2) return null;
  const cabecalho = linhas[0].map(normalizarCabecalho);
  const coluna = (...nomes: string[]) =>
    cabecalho.findIndex((item) => nomes.includes(item));
  const tipo = coluna("RECORD_TYPE", "TIPO_DE_REGISTRO");
  const saldo = coluna("BALANCE_AMOUNT", "SALDO");
  const credito = coluna("NET_CREDIT_AMOUNT", "NET_CREDIT");
  const debito = coluna("NET_DEBIT_AMOUNT", "NET_DEBIT");
  const bruto = coluna("GROSS_AMOUNT");
  const descricao = coluna("DESCRIPTION", "DESCRICAO");
  const valor = (linha: string[], indice: number) =>
    indice >= 0 ? numeroPlanilha(linha[indice] ?? "") : null;
  const registro = (linha: string[]) =>
    (tipo >= 0 ? normalizarCabecalho(linha[tipo] ?? "") : "").toLowerCase();
  const ehResumo = (linha: string[]) => {
    const nome = registro(linha);
    if (nome === "total" || nome === "subtotal") return true;
    if (descricao < 0) return false;
    const texto = normalizarCabecalho(linha[descricao] ?? "");
    return texto === "TOTAL" || texto === "SUBTOTAL";
  };
  if (tipo < 0 && credito >= 0 && linhas.length > 2) {
    const ultima = linhas[linhas.length - 1];
    const creditoUltima = valor(ultima, credito);
    let soma = 0;
    for (let i = 1; i < linhas.length - 1; i++) {
      soma += valor(linhas[i], credito) ?? 0;
    }
    const saldoUltimo = valor(ultima, saldo);
    const saldoAnterior = valor(linhas[linhas.length - 2], saldo);
    if (
      creditoUltima !== null &&
      Math.abs(Math.round(creditoUltima * 100) - Math.round(soma * 100)) <= 1 &&
      (saldoUltimo === null || saldoUltimo === 0) && saldoAnterior !== null &&
      saldoAnterior !== 0
    ) {
      linhas.pop();
    }
  }
  const ignorar = new Set([
    "total",
    "subtotal",
    "initial_available_balance",
    "available_balance",
  ]);
  if (saldo >= 0) {
    for (let i = linhas.length - 1; i >= 1; i--) {
      if (ehResumo(linhas[i])) continue;
      const nome = registro(linhas[i]);
      if (nome === "total" || nome === "subtotal") continue;
      const n = valor(linhas[i], saldo);
      if (n !== null) return n;
    }
  }
  let inicial: number | null = null;
  let movimento = 0;
  let teveMovimento = false;
  for (let i = 1; i < linhas.length; i++) {
    const nome = registro(linhas[i]);
    if (nome === "initial_available_balance") {
      inicial = valor(linhas[i], saldo) ?? valor(linhas[i], credito) ??
        valor(linhas[i], bruto);
      continue;
    }
    if (ignorar.has(nome) || nome === "") continue;
    const entrada = valor(linhas[i], credito) ?? 0;
    const saida = valor(linhas[i], debito) ?? 0;
    if (
      valor(linhas[i], credito) !== null || valor(linhas[i], debito) !== null
    ) {
      movimento += entrada - saida;
      teveMovimento = true;
    }
  }
  if (inicial !== null) return inicial + (teveMovimento ? movimento : 0);
  return null;
}

async function mpJson(
  url: string,
  auth: Record<string, string>,
  method = "GET",
  body?: string,
) {
  const resposta = await fetch(url, {
    method,
    headers: {
      ...auth,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const texto = await resposta.text();
  let corpo: unknown = null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = null;
  }
  return { status: resposta.status, corpo };
}

async function saldoPeloRelatorio(auth: Record<string, string>) {
  const semReferencia = {
    saldo_referencia_em: null as string | null,
    relatorio_gerado_em: null as string | null,
    relatorio_periodo_fim: null as string | null,
    referencia_tipo: null as "fim_periodo" | "geracao_relatorio" | null,
    desatualizado: true,
  };
  const listaResposta = await mpJson(
    "https://api.mercadopago.com/v1/account/release_report/list",
    auth,
  );
  if (listaResposta.status === 403) {
    return { saldo: null, erro: "sem_permissao" as const, ...semReferencia };
  }
  const listaBruta = listaResposta.corpo;
  const lista = Array.isArray(listaBruta)
    ? listaBruta
    : listaBruta && typeof listaBruta === "object" &&
        Array.isArray((listaBruta as { results?: unknown }).results)
    ? (listaBruta as { results: unknown[] }).results
    : null;
  if (listaResposta.status !== 200 || !lista) {
    return { saldo: null, erro: "indisponivel" as const, ...semReferencia };
  }
  const agora = Date.now();
  const itens = (lista as Record<string, unknown>[])
    .map((item) => ({
      arquivo: typeof item.file_name === "string" ? item.file_name : "",
      criado: Date.parse(String(item.date_created || "")) || 0,
      referencia: Date.parse(String(item.end_date || item.date_to || "")) || 0,
    }))
    .sort((a, b) => b.criado - a.criado);
  const pronto = itens.find((item) => item.arquivo);
  const gerando = itens.some((item) =>
    !item.arquivo && agora - item.criado < 20 * 60 * 1000
  );
  const fresco = Boolean(
    pronto && pronto.criado > 0 && pronto.criado <= agora &&
      agora - pronto.criado < 3 * 60 * 60 * 1000,
  );
  // A report may describe a window ending later today. Its future end is period
  // metadata, not proof of a future financial snapshot. Generation is identified
  // separately and never substituted into saldo_referencia_em.
  const fimValido =
    pronto?.referencia && pronto.referencia > 0 && pronto.referencia <= agora
      ? pronto.referencia
      : null;
  const geracaoValida =
    pronto?.criado && pronto.criado > 0 && pronto.criado <= agora
      ? pronto.criado
      : null;
  const idadeReferencia = fimValido || geracaoValida;
  const referencia = {
    saldo_referencia_em: fimValido ? new Date(fimValido).toISOString() : null,
    relatorio_gerado_em: pronto?.criado
      ? new Date(pronto.criado).toISOString()
      : null,
    relatorio_periodo_fim: pronto?.referencia
      ? new Date(pronto.referencia).toISOString()
      : null,
    referencia_tipo: fimValido
      ? "fim_periodo" as const
      : geracaoValida
      ? "geracao_relatorio" as const
      : null,
    desatualizado: !idadeReferencia ||
      agora - idadeReferencia > 3 * 60 * 60 * 1000,
  };
  let valor: number | null = null;
  if (pronto) {
    const arquivo = await fetch(
      `https://api.mercadopago.com/v1/account/release_report/${
        encodeURIComponent(pronto.arquivo)
      }`,
      { headers: auth, signal: AbortSignal.timeout(15000) },
    );
    if (arquivo.ok) {
      const csv = await arquivo.text();
      if (!csv.startsWith("PK")) valor = saldoDoRelatorio(csv);
    }
  }
  if (!fresco && !gerando && agora - relatorioPedidoEm > 20 * 60 * 1000) {
    relatorioPedidoEm = agora;
    const fim = new Date();
    const inicio = new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);
    const criado = await mpJson(
      "https://api.mercadopago.com/v1/account/release_report",
      auth,
      "POST",
      JSON.stringify({
        begin_date: inicio.toISOString().replace(/\.\d{3}Z$/, "Z"),
        end_date: fim.toISOString().replace(/\.\d{3}Z$/, "Z"),
      }),
    );
    if (
      valor === null && criado.status !== 200 && criado.status !== 201 &&
      criado.status !== 202
    ) {
      return { saldo: null, erro: "indisponivel" as const, ...referencia };
    }
  }
  if (valor !== null) return { saldo: valor, erro: null, ...referencia };
  if (!fresco || gerando || agora - relatorioPedidoEm < 20 * 60 * 1000) {
    return { saldo: null, erro: "preparando" as const, ...referencia };
  }
  return { saldo: null, erro: "indisponivel" as const, ...referencia };
}

async function requireMercadoPago(req: Request) {
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
    return json(
      { ok: false, error: "A conta Mercado Pago é da holding." },
      403,
    );
  }
  return null;
}

export const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ ok: false, error: "Método não permitido." }, 405);
  }
  const denied = await requireMercadoPago(req);
  if (denied) return denied;
  try {
    if (!MP_TOKEN) {
      return json({ ok: false, error: "MP_ACCESS_TOKEN nao configurado" }, 500);
    }
    const auth = { Authorization: `Bearer ${MP_TOKEN}` };
    const meResponse = await fetch("https://api.mercadopago.com/users/me", {
      headers: { ...auth, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const me = await meResponse.json().catch(() => null);
    if (!me?.id) {
      return json({ ok: false, error: "token invalido ou sem permissao" }, 502);
    }
    const balanceResponse = await fetch(
      `https://api.mercadopago.com/users/${me.id}/mercadopago_account/balance`,
      {
        headers: { ...auth, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      },
    );
    let saldo: {
      available_balance: number | null;
      unavailable_balance: number | null;
      total_amount: number | null;
    } | null = null;
    let saldoOk = false;
    let saldoErro: string | null = null;
    let origem: string | null = null;
    let referencia = {
      saldo_referencia_em: null as string | null,
      relatorio_gerado_em: null as string | null,
      relatorio_periodo_fim: null as string | null,
      referencia_tipo: null as "fim_periodo" | "geracao_relatorio" | null,
      desatualizado: false,
    };
    if (balanceResponse.status === 403) {
      const relatorio = await saldoPeloRelatorio(auth);
      referencia = {
        saldo_referencia_em: relatorio.saldo_referencia_em,
        relatorio_gerado_em: relatorio.relatorio_gerado_em,
        relatorio_periodo_fim: relatorio.relatorio_periodo_fim,
        referencia_tipo: relatorio.referencia_tipo,
        desatualizado: relatorio.desatualizado,
      };
      if (relatorio.saldo !== null) {
        saldo = {
          available_balance: relatorio.saldo,
          unavailable_balance: null,
          total_amount: relatorio.saldo,
        };
        saldoOk = true;
        origem = "relatorio";
      } else {
        saldoErro = relatorio.erro;
        if (saldoErro === "preparando") origem = "relatorio";
      }
    } else if (balanceResponse.ok) {
      saldo = lerSaldoMercadoPago(
        await balanceResponse.json().catch(() => null),
      );
      saldoOk = saldo !== null;
      if (!saldoOk) saldoErro = "indisponivel";
      else origem = "conta";
    } else {
      saldoErro = "indisponivel";
    }
    return json({
      ok: true,
      conta: { id: String(me.id), nickname: me.nickname ?? null, moeda: "BRL" },
      saldo_ok: saldoOk,
      saldo,
      saldo_erro: saldoErro,
      origem,
      ...referencia,
      atualizado_em: null,
      consultado_em: new Date().toISOString(),
    });
  } catch {
    return json({
      ok: false,
      error: "Não foi possível consultar o Mercado Pago.",
    }, 502);
  }
};

if (import.meta.main) Deno.serve(handler);
