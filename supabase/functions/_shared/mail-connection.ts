import { type Connection, HttpError, requireCredentials } from "./email.ts";

const encoder = new TextEncoder();
export const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
export const quote = (value: string) => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

// Fixed lifetime bounds all reads/writes. No provider transcript is logged/returned.
export class MailConnection {
  private buffer = new Uint8Array(0);
  private timer: ReturnType<typeof setTimeout>;
  private constructor(private conn: Deno.TlsConn) {
    this.timer = setTimeout(() => this.close(), 25000);
  }
  static async open(config: Connection) {
    requireCredentials(config);
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const opening = Deno.connectTls({ hostname: config.host, port: config.port }).then(conn => {
      if (timedOut) { conn.close(); throw new Error("timeout"); }
      return conn;
    });
    try {
      const conn = await Promise.race([opening, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(new Error("timeout")); }, 10000);
      })]);
      return new MailConnection(conn);
    } finally { clearTimeout(timer!); }
  }
  close() { clearTimeout(this.timer); try { this.conn.close(); } catch { /* closed */ } }
  async write(value: string) {
    const bytes = encoder.encode(value + "\r\n");
    let offset = 0;
    while (offset < bytes.length) offset += await this.conn.write(bytes.subarray(offset));
  }
  private async fill() {
    const bytes = new Uint8Array(16384), count = await this.conn.read(bytes);
    if (count === null) throw new Error("connection closed");
    const joined = new Uint8Array(this.buffer.length + count);
    joined.set(this.buffer); joined.set(bytes.subarray(0, count), this.buffer.length);
    this.buffer = joined;
  }
  async line() {
    while (true) {
      for (let i = 0; i < this.buffer.length - 1; i++) {
        if (this.buffer[i] === 13 && this.buffer[i + 1] === 10) {
          const result = decode(this.buffer.subarray(0, i)); this.buffer = this.buffer.slice(i + 2); return result;
        }
      }
      if (this.buffer.length > 65536) throw new Error("line too large");
      await this.fill();
    }
  }
  async literal(size: number) {
    if (!Number.isSafeInteger(size) || size < 0 || size > 8000000) throw new HttpError(413, "Mensagem grande demais para abrir no dashboard.");
    while (this.buffer.length < size) await this.fill();
    const result = this.buffer.slice(0, size); this.buffer = this.buffer.slice(size); return result;
  }
}
export class Imap {
  private tag = 0;
  private constructor(private connection: MailConnection) {}
  static async open(config: Connection) {
    const connection = await MailConnection.open(config);
    try {
      if (!(await connection.line()).startsWith("* OK")) throw new Error("IMAP greeting");
      const imap = new Imap(connection);
      await imap.command(`LOGIN ${quote(config.user)} ${quote(config.password)}`);
      return imap;
    } catch (error) { connection.close(); throw error; }
  }
  close() { this.connection.close(); }
  async command(command: string) {
    const tag = `A${++this.tag}`, lines: string[] = [], literals: { meta: string; bytes: Uint8Array }[] = [];
    await this.connection.write(`${tag} ${command}`);
    let bytesRead = 0;
    while (true) {
      const line = await this.connection.line();
      bytesRead += line.length;
      if (line.startsWith(tag + " ")) {
        if (!line.startsWith(tag + " OK")) throw new Error("IMAP command failed");
        return { lines, literals };
      }
      lines.push(line);
      const match = line.match(/\{(\d+)\}$/);
      if (match) {
        const size = Number(match[1]); bytesRead += size;
        if (bytesRead > 8500000) throw new HttpError(413, "Mensagem grande demais para abrir no dashboard.");
        literals.push({ meta: line, bytes: await this.connection.literal(size) });
      }
      if (lines.length > 10000 || bytesRead > 8500000) throw new Error("IMAP response limit");
    }
  }
  async select() {
    const response = await this.command("SELECT INBOX");
    const text = response.lines.join("\n");
    const validity = text.match(/\[UIDVALIDITY (\d+)\]/i)?.[1];
    if (!validity || BigInt(validity) < 1n) throw new Error("IMAP UIDVALIDITY missing");
    return { validity, total: Number(text.match(/\* (\d+) EXISTS/)?.[1] || 0) };
  }
}
export async function verifySmtp(config: Connection) {
  const connection = await MailConnection.open(config);
  async function response(expected: number) {
    let line = "";
    for (let n = 0; n < 100; n++) {
      line = await connection.line();
      if (!/^\d{3}[- ]/.test(line) || Number(line.slice(0, 3)) !== expected) throw new Error("SMTP authentication failed");
      if (line[3] === " ") return;
    }
    throw new Error("SMTP response limit");
  }
  try {
    await response(220);
    await connection.write("EHLO arcadehub.tech"); await response(250);
    const bytes = encoder.encode(`\0${config.user}\0${config.password}`);
    const encoded = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(""));
    await connection.write("AUTH PLAIN " + encoded); await response(235);
    try { await connection.write("QUIT"); await response(221); } catch { /* AUTH already succeeded */ }
  } finally { connection.close(); }
}
