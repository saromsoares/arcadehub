// Local only: HTTP/Auth/PostgREST and TLS are replaced with deterministic fixtures.
// Run: npx --yes deno test --allow-env supabase/tests/email-functions_test.ts
// No --allow-net: an accidentally unmocked socket is denied by Deno.
import assert from "node:assert/strict";

Deno.env.set("SUPABASE_URL", "https://qa.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "qa-service-key");
Deno.env.set("SUPABASE_ANON_KEY", "qa-anon-key");
Deno.env.set("MAILBOX_ALPHA_PASS_B64", btoa("fixture-password"));
Deno.env.set("SMTP_USER", "legacy@example.test");
Deno.env.set("SMTP_PASS", "legacy-fixture-password");
for (const key of ["IMAP_USER", "IMAP_PASS", "SMTP_FROM", "IMAP_HOST", "IMAP_PORT", "SMTP_HOST", "SMTP_PORT", "EMAIL_SYNC_CRON_TOKEN"]) Deno.env.delete(key);

type Row = Record<string, unknown>;
type Call = { kind: string; method?: string; url?: URL; payload?: Row; authorization?: string; hostname?: string };
const verified = "2026-10-15T12:00:00Z";
const mailbox = { id: "alpha", email: "alpha@example.test", label: "Alpha", is_legacy: false, enabled: true, credentials_revision: 0, imap_verified_at: verified, smtp_verified_at: verified };
let boxes: Row[] = [], message: Row | null = null, legacy: Row | null = null;
let denyMailbox = false, insertFails = false, updateFails = false, revisionChanged = false;
let calls: Call[] = [], sockets: FixtureSocket[] = [], transcripts: string[] = [];
const encoder = new TextEncoder();

class FixtureSocket {
  bytes: Uint8Array;
  written = "";
  closed = false;
  cursor = 0;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  constructor(transcript: string) {
    this.bytes = encoder.encode(transcript);
    this.readable = new ReadableStream({ start: controller => {
      this.controller = controller;
      controller.enqueue(this.bytes);
    } });
    this.writable = new WritableStream({ write: bytes => { this.written += new TextDecoder().decode(bytes); } });
  }
  read(bytes: Uint8Array): Promise<number | null> {
    if (this.closed || this.cursor === this.bytes.length) return Promise.resolve(null);
    // Split CRLFs and literals across reads to exercise buffering.
    const count = Math.min(7, bytes.length, this.bytes.length - this.cursor);
    bytes.set(this.bytes.subarray(this.cursor, this.cursor + count));
    this.cursor += count;
    return Promise.resolve(count);
  }
  write(bytes: Uint8Array) { this.written += new TextDecoder().decode(bytes); return Promise.resolve(bytes.length); }
  close() { this.closed = true; try { this.controller.close(); } catch { /* already closed */ } }
}

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init), url = new URL(request.url);
  assert.equal(url.hostname, "qa.invalid", "No external HTTP is allowed by this fixture");
  const authorization = request.headers.get("authorization") || "";
  const payload = request.method === "GET" ? undefined : await request.json() as Row;
  calls.push({ kind: "http", method: request.method, url, payload, authorization });
  const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (url.pathname === "/auth/v1/user") return authorization === "Bearer user-token"
    ? response({ id: "00000000-0000-4000-8000-000000000001", email: "viewer@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} })
    : response({ message: "Invalid token" }, 401);
  if (url.pathname === "/rest/v1/email_mailboxes") {
    if (request.method === "PATCH") return response(revisionChanged ? [] : [{ id: "alpha" }]);
    return response(denyMailbox ? [] : boxes.filter(b => (!url.searchParams.has("id") || "eq." + b.id === url.searchParams.get("id")) && b.enabled));
  }
  if (url.pathname === "/rest/v1/emails") {
    if (request.method === "GET") return response(url.searchParams.get("imap_uidvalidity") === "is.null" ? (legacy ? [legacy] : []) : (message ? [message] : []));
    if (request.method === "POST") return insertFails ? response({ message: "Database unavailable", code: "XX000" }, 500) : response(request.headers.get("accept")?.includes("object") ? { id: 100 } : null, 201);
    if (request.method === "PATCH") return updateFails ? response({ message: "Database unavailable", code: "XX000" }, 500) : response(null);
  }
  throw new Error("Unexpected mock HTTP request: " + request.method + " " + url.pathname);
};
Deno.connectTls = ((options: Deno.ConnectTlsOptions) => {
  calls.push({ kind: "tls", hostname: options.hostname });
  assert.ok(transcripts.length, "No real TLS socket may be opened");
  const socket = new FixtureSocket(transcripts.shift()!);
  sockets.push(socket);
  return Promise.resolve(socket as unknown as Deno.TlsConn);
}) as typeof Deno.connectTls;

const accounts = (await import("../functions/email-accounts/index.ts")).handler;
const check = (await import("../functions/email-check/index.ts")).handler;
const sync = (await import("../functions/email-sync/index.ts")).handler;
const readBody = (await import("../functions/email-body/index.ts")).handler;
const send = (await import("../functions/email-send/index.ts")).handler;
const { parseMessage, decodeWords } = await import("../functions/_shared/mime.js");
const handlers = [accounts, check, sync, readBody, send];

function reset() {
  boxes = [{ ...mailbox }]; message = null; legacy = null;
  denyMailbox = false; insertFails = false; updateFails = false; revisionChanged = false;
  calls = []; sockets = []; transcripts = [];
  Deno.env.delete("EMAIL_SYNC_CRON_TOKEN");
}
function req(payload: Row = {}, token: string | null = "user-token", extra: Record<string, string> = {}) {
  return new Request("https://functions.invalid", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...extra }, body: JSON.stringify(payload) });
}
function imapFixture(content = "", validity = "42", uid = "7") {
  const start = `* OK Ready\r\nA1 OK login\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY ${validity}] valid\r\nA2 OK selected\r\n`;
  return start + (content ? `* 1 FETCH (UID ${uid} FLAGS (\\Seen) BODY[] {${encoder.encode(content).length}}\r\n${content}\r\n)\r\nA3 OK fetched\r\n` : "");
}
const mail = "Message-ID: <identity@example.test>\r\nDate: Thu, 15 Oct 2026 12:00:00 +0000\r\nFrom: Client <client@example.test>\r\nTo: alpha@example.test\r\nSubject: Fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOlá, corpo de teste.";
const smtpAccepted = "220 ready\r\n250 AUTH LOGIN\r\n334 username\r\n334 password\r\n235 authenticated\r\n250 initial noop\r\n250 sender\r\n250 recipient\r\n354 data\r\n250 accepted\r\n250 noop\r\n";
const delivery = { mailbox_id: "alpha", to: "recipient@example.test", subject: "Fixture", text: "Local only" };
const dbCalls = (method: string) => calls.filter(c => c.method === method && c.url?.pathname === "/rest/v1/emails");

Deno.test("Every endpoint rejects absent/invalid user credentials before mailbox or provider access", async () => {
  reset();
  for (const handler of handlers) for (const token of [null, "bad-token"]) {
    const response = await handler(req({ mailbox_id: "alpha", id: 1 }, token));
    assert.equal(response.status, 401);
    await response.arrayBuffer();
  }
  assert.equal(sockets.length, 0);
  assert.ok(calls.every(c => c.url?.pathname === "/auth/v1/user"));
});

Deno.test("All mailbox operations deny an RLS-hidden mailbox and invalid IDs do not select legacy", async () => {
  reset(); denyMailbox = true;
  for (const handler of [check, sync, readBody, send]) {
    let response = await handler(req({ mailbox_id: "alpha", id: 1 }));
    assert.equal(response.status, 403); await response.arrayBuffer();
    response = await handler(req({ mailbox_id: "", id: 1 }));
    assert.equal(response.status, 400); await response.arrayBuffer();
  }
  assert.equal(sockets.length, 0);
  assert.equal(dbCalls("POST").length, 0);
  assert.ok(calls.filter(c => c.url?.pathname === "/rest/v1/email_mailboxes").every(c => c.authorization === "Bearer user-token"));
});

Deno.test("Discovery uses user-scoped requests and never serializes credentials", async () => {
  reset(); boxes.push({ ...mailbox, id: "pending", email: "pending@example.test", imap_verified_at: null, smtp_verified_at: null });
  const response = await accounts(req()), raw = await response.text(), data = JSON.parse(raw);
  assert.equal(response.status, 200);
  assert.equal(data.accounts[0].can_send, true);
  assert.equal(data.accounts[1].can_send, false);
  assert.equal(data.accounts[1].can_sync, false);
  assert.equal(data.accounts[1].status, "pending_credentials");
  assert.ok(!raw.includes("fixture-password") && !raw.includes("qa-service-key"));
  assert.equal(calls.find(c => c.url?.pathname === "/rest/v1/email_mailboxes")?.authorization, "Bearer user-token");
});

Deno.test("Omitted mailbox ID selects legacy but unverified bootstrap cannot send/sync", async () => {
  reset(); boxes = [{ ...mailbox, id: "arcade_hub", is_legacy: true, email: null, imap_verified_at: null, smtp_verified_at: null }];
  for (const handler of [sync, send]) {
    const response = await handler(req()); assert.equal(response.status, 409); await response.arrayBuffer();
  }
  assert.equal(sockets.length, 0);
  assert.ok(calls.filter(c => c.url?.pathname === "/rest/v1/email_mailboxes").every(c => c.url?.searchParams.get("id") === "eq.arcade_hub"));
});

Deno.test("Body lookup scopes message to authorized mailbox and rejects arbitrary client UID", async () => {
  reset();
  const response = await readBody(req({ mailbox_id: "alpha", id: 99, uid_imap: "INBOX:987654" }));
  assert.equal(response.status, 404); await response.arrayBuffer();
  const query = dbCalls("GET")[0];
  assert.equal(query.authorization, "Bearer user-token");
  assert.equal(query.url?.searchParams.get("mailbox_id"), "eq.alpha");
  assert.equal(sockets.length, 0);
});

Deno.test("Cached body returns without provider access", async () => {
  reset(); message = { id: 1, corpo_texto: "Cached body", corpo_html: null };
  const response = await readBody(req({ mailbox_id: "alpha", id: 1 }));
  assert.equal((await response.json()).cached, true);
  assert.equal(sockets.length, 0);
});

Deno.test("UIDVALIDITY mismatch fails before fetching any body", async () => {
  reset(); message = { id: 1, uid_imap: "INBOX:7", imap_uidvalidity: 41 };
  transcripts = [imapFixture()];
  const response = await readBody(req({ mailbox_id: "alpha", id: 1 }));
  assert.equal(response.status, 409); await response.arrayBuffer();
  assert.ok(!sockets[0].written.includes("FETCH"));
  assert.ok(sockets[0].closed);
  assert.equal(dbCalls("PATCH").length, 0);
});

Deno.test("Body uses stored UID and handles fragmented UTF-8 literal without mutating another mailbox", async () => {
  reset(); message = { id: 1, uid_imap: "INBOX:7", imap_uidvalidity: 42 };
  transcripts = [imapFixture(mail)];
  const response = await readBody(req({ mailbox_id: "alpha", id: 1, uid_imap: "INBOX:999" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).corpo_texto, "Olá, corpo de teste.");
  assert.ok(sockets[0].written.includes("UID FETCH 7"));
  assert.ok(!sockets[0].written.includes("999"));
  assert.equal(dbCalls("PATCH")[0].url?.searchParams.get("mailbox_id"), "eq.alpha");
  assert.ok(sockets[0].closed);
});

Deno.test("Legacy body requires matching Message-ID before caching an unbound epoch", async () => {
  reset(); message = { id: 1, uid_imap: "INBOX:7", imap_uidvalidity: null, message_id: "<wrong@example.test>" };
  transcripts = [imapFixture(mail)];
  const response = await readBody(req({ mailbox_id: "alpha", id: 1 }));
  assert.equal(response.status, 409); await response.arrayBuffer();
  assert.equal(dbCalls("PATCH").length, 0);
});

Deno.test("Sync inserts mailbox/epoch identity and parses flags and headers", async () => {
  reset(); transcripts = [imapFixture(mail)];
  const response = await sync(req({ mailbox_id: "alpha" }));
  assert.equal(response.status, 200); assert.equal((await response.json()).novos, 1);
  const row = dbCalls("POST")[0].payload!;
  assert.equal(row.mailbox_id, "alpha"); assert.equal(row.imap_uidvalidity, "42");
  assert.equal(row.uid_imap, "INBOX:7"); assert.equal(row.lido, true);
  assert.equal(row.message_id, "<identity@example.test>");
  assert.ok(sockets[0].closed);
});

Deno.test("Sync adopts legacy UID only when Message-ID also agrees", async () => {
  reset(); legacy = { id: 12, message_id: "<identity@example.test>" }; transcripts = [imapFixture(mail)];
  const response = await sync(req({ mailbox_id: "alpha" }));
  assert.equal(response.status, 200); await response.arrayBuffer();
  assert.equal(dbCalls("POST").length, 0);
  assert.equal(dbCalls("PATCH")[0].payload?.imap_uidvalidity, "42");
  assert.equal(dbCalls("PATCH")[0].url?.searchParams.get("mailbox_id"), "eq.alpha");
});

Deno.test("Sync preserves legacy history when reused UID has a different Message-ID", async () => {
  reset(); legacy = { id: 12, message_id: "<old@example.test>" }; transcripts = [imapFixture(mail)];
  const response = await sync(req({ mailbox_id: "alpha" }));
  assert.equal(response.status, 200); await response.arrayBuffer();
  assert.equal(dbCalls("PATCH").length, 0); assert.equal(dbCalls("POST").length, 1);
});

Deno.test("Cron requires dedicated token and explicit mailbox; token cannot access other endpoints", async () => {
  reset(); Deno.env.set("EMAIL_SYNC_CRON_TOKEN", "test-cron-secret");
  let response = await sync(req({ mailbox_id: "alpha" }, null, { "x-email-cron-token": "wrong" }));
  assert.equal(response.status, 401); await response.arrayBuffer();
  response = await sync(req({}, null, { "x-email-cron-token": "test-cron-secret" }));
  assert.equal(response.status, 400); await response.arrayBuffer();
  response = await send(req(delivery, null, { "x-email-cron-token": "test-cron-secret" }));
  assert.equal(response.status, 401); await response.arrayBuffer();
  transcripts = [imapFixture(mail)];
  response = await sync(req({ mailbox_id: "alpha" }, null, { "x-email-cron-token": "test-cron-secret" }));
  assert.equal(response.status, 200); await response.arrayBuffer();
});

Deno.test("Connection check authenticates IMAP/SMTP without MAIL, RCPT or DATA", async () => {
  reset(); transcripts = [imapFixture(), "220 ready\r\n250-auth plain\r\n250 ok\r\n235 authenticated\r\n221 bye\r\n"];
  const response = await check(req({ mailbox_id: "alpha" }));
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  assert.equal(sockets.length, 2);
  assert.ok(sockets.every(s => s.closed));
  assert.ok(sockets.every(s => !/\b(MAIL FROM|RCPT TO|DATA)\b/.test(s.written)));
  const update = calls.find(c => c.method === "PATCH")!.payload!;
  assert.ok(update.imap_verified_at && update.smtp_verified_at);
});

Deno.test("Connection check refuses stale credential verification after revision changes", async () => {
  reset(); revisionChanged = true;
  transcripts = [imapFixture(), "220 ready\r\n250 ok\r\n235 authenticated\r\n221 bye\r\n"];
  const response = await check(req({ mailbox_id: "alpha" }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /senha foi alterada/);
  const update = calls.find(c => c.method === "PATCH")!;
  assert.equal(update.url?.searchParams.get("credentials_revision"), "eq.0");
  assert.equal(update.url?.searchParams.get("id"), "eq.alpha");
});

Deno.test("Partial connection verification clears failed SMTP readiness without exposing transcript", async () => {
  reset(); transcripts = [imapFixture(), "220 ready\r\n250 ok\r\n535 fixture-password should stay private\r\n"];
  const response = await check(req({ mailbox_id: "alpha" })), raw = await response.text(), data = JSON.parse(raw);
  assert.equal(response.status, 200); assert.equal(data.ok, false);
  assert.equal(data.imap, true); assert.equal(data.smtp, false);
  assert.ok(!raw.includes("fixture-password"));
  const update = calls.find(c => c.method === "PATCH")!.payload!;
  assert.ok(update.imap_verified_at); assert.equal(update.smtp_verified_at, null);
});

Deno.test("Legacy connection bootstrap confirms server identity and records readiness without delivery", async () => {
  reset(); boxes = [{ ...mailbox, id: "arcade_hub", email: null, is_legacy: true, imap_verified_at: null, smtp_verified_at: null }];
  transcripts = [imapFixture(), "220 ready\r\n250 ok\r\n235 authenticated\r\n221 bye\r\n"];
  const response = await check(req()), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.ok, true);
  assert.equal(data.email, "legacy@example.test");
  const update = calls.find(c => c.method === "PATCH")!.payload!;
  assert.equal(update.email, "legacy@example.test");
  assert.ok(update.imap_verified_at && update.smtp_verified_at);
  assert.ok(sockets.every(s => !/\b(MAIL FROM|RCPT TO|DATA)\b/.test(s.written)));
});

Deno.test("Send must persist attempt before SMTP; database failure opens no provider socket", async () => {
  reset(); insertFails = true;
  const response = await send(req(delivery));
  assert.equal(response.status, 502); await response.arrayBuffer();
  assert.equal(sockets.length, 0);
});

Deno.test("Send resolves sender server-side and persists accepted delivery", async () => {
  reset(); transcripts = [smtpAccepted];
  const response = await send(req({ ...delivery, from: "attacker@example.test", smtp_user: "attacker@example.test" }));
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  const row = dbCalls("POST")[0].payload!;
  assert.equal(row.de, "alpha@example.test"); assert.equal(row.status, "pendente");
  assert.ok(calls.indexOf(dbCalls("POST")[0]) < calls.findIndex(c => c.kind === "tls"));
  assert.ok(sockets[0].written.includes("<alpha@example.test>"));
  assert.ok(!sockets[0].written.includes("attacker@example.test"));
  assert.equal(dbCalls("PATCH")[0].payload?.status, "enviado");
  assert.ok(sockets[0].closed);
});

Deno.test("Accepted SMTP with failed history update returns warning without claiming delivery failed", async () => {
  reset(); updateFails = true; transcripts = [smtpAccepted];
  const response = await send(req(delivery)), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.ok, true);
  assert.match(data.warning, /Não reenvie/);
});

Deno.test("Rejected SMTP authentication produces sanitized failure and no success record", async () => {
  reset(); transcripts = ["220 ready\r\n250 AUTH LOGIN\r\n535 fixture-password should stay private\r\n"];
  const response = await send(req(delivery)), raw = await response.text();
  assert.equal(response.status, 502);
  assert.ok(!raw.includes("fixture-password"));
  assert.equal(dbCalls("PATCH")[0].payload?.status, "falha");
  assert.ok(!sockets[0].written.includes("MAIL FROM"));
});

Deno.test("Header injection is rejected before delivery persistence or SMTP", async () => {
  reset();
  for (const override of [{ subject: "Safe\r\nBcc: victim@example.test" }, { to: "recipient@example.test\r\nDATA" }]) {
    const response = await send(req({ ...delivery, ...override }));
    assert.equal(response.status, 400); await response.arrayBuffer();
  }
  assert.equal(sockets.length, 0); assert.equal(dbCalls("POST").length, 0);
});

Deno.test("MIME fixtures decode multipart text/html, ignore attachment text and unfold encoded headers", () => {
  const raw = "Content-Type: multipart/mixed; boundary=outer\r\n\r\n--outer\r\nContent-Type: text/plain\r\nContent-Disposition: attachment\r\n\r\nNot the message\r\n--outer\r\nContent-Type: multipart/alternative; boundary=inner\r\n\r\n--inner\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nOl=C3=A1\r\n--inner\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nPHA+T2zDoTwvcD4=\r\n--inner--\r\n--outer--\r\n";
  const parsed = parseMessage(encoder.encode(raw));
  assert.equal(parsed.corpo_texto.trim(), "Olá"); assert.equal(parsed.corpo_html, "<p>Olá</p>");
  assert.equal(decodeWords("=?UTF-8?Q?Ol=C3=A1?= =?UTF-8?Q?_mundo?="), "Olá mundo");
});
