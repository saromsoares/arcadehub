const CRLF = String.fromCharCode(13, 10);
const DQ = String.fromCharCode(34);
const BS = String.fromCharCode(92);
const QM = String.fromCharCode(63);
const TAB = String.fromCharCode(9);

function cat(a, b) { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }
function bidx(buf, sub, from) { const n = sub.length; for (let i = from; i <= buf.length - n; i++) { let ok = true; for (let j = 0; j < n; j++) { if (buf[i + j] !== sub.charCodeAt(j)) { ok = false; break; } } if (ok) return i; } return -1; }
function q(s) { let r = DQ; for (const ch of s) { if (ch === DQ || ch === BS) r += BS; r += ch; } return r + DQ; }
function latin1ToBytes(s) { const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff; return out; }

// Header unfold + case-insensitive lookup sobre um bloco de cabecalhos (string latin1)
function headerVal(hdr, name) {
  const lines = hdr.split(CRLF); const out = [];
  for (const ln of lines) { if ((ln.startsWith(" ") || ln.startsWith(TAB)) && out.length) out[out.length - 1] += " " + ln.trim(); else out.push(ln); }
  const low = name.toLowerCase() + ":";
  for (const ln of out) { if (ln.toLowerCase().startsWith(low)) return ln.slice(name.length + 1).trim(); }
  return "";
}
function paramOf(ctRaw, key) {
  const re = new RegExp(key + "\\s*=\\s*(" + DQ + "([^" + DQ + "]*)" + DQ + "|([^;\\s]+))", "i");
  const m = ctRaw.match(re); if (!m) return ""; return (m[2] !== undefined ? m[2] : m[3]) || "";
}
function splitHB(s) { const i = s.indexOf(CRLF + CRLF); if (i < 0) return [s, ""]; return [s.slice(0, i), s.slice(i + 4)]; }

function decodeContent(body, cte, charset) {
  let bytes;
  if (cte === "base64") { const clean = body.replace(/[^A-Za-z0-9+/=]/g, ""); try { const bin = atob(clean); bytes = Uint8Array.from(bin, (x) => x.charCodeAt(0)); } catch { bytes = latin1ToBytes(body); } }
  else if (cte === "quoted-printable") {
    let t = body.split("=" + CRLF).join("").split("=\n").join("");
    let s = "";
    for (let k = 0; k < t.length; k++) { const ch = t[k]; if (ch === "=" && k + 2 < t.length) { const hx = t.substr(k + 1, 2); if (/^[0-9A-Fa-f]{2}$/.test(hx)) { s += String.fromCharCode(parseInt(hx, 16)); k += 2; continue; } } s += ch; }
    bytes = latin1ToBytes(s);
  } else { bytes = latin1ToBytes(body); }
  try { return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes); } catch { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
}

function splitParts(body, bnd) {
  const delim = "--" + bnd; const segs = body.split(delim); const res = [];
  for (let i = 1; i < segs.length; i++) { let seg = segs[i]; if (seg.startsWith("--")) break; if (seg.startsWith(CRLF)) seg = seg.slice(2); else if (seg.startsWith("\n")) seg = seg.slice(1); res.push(seg); }
  return res;
}

function walk(part, out, depth) {
  if (depth > 12) return;
  const [hdr, body] = splitHB(part);
  const ctRaw = headerVal(hdr, "Content-Type") || "text/plain";
  const ct = ctRaw.toLowerCase();
  const cte = (headerVal(hdr, "Content-Transfer-Encoding") || "").toLowerCase().trim();
  const disp = (headerVal(hdr, "Content-Disposition") || "").toLowerCase();
  if (ct.startsWith("multipart/")) {
    const bnd = paramOf(ctRaw, "boundary"); if (!bnd) return;
    for (const p of splitParts(body, bnd)) walk(p, out, depth + 1);
  } else if (disp.startsWith("attachment")) {
    return; // ignora anexos
  } else if (ct.startsWith("text/html")) {
    if (!out.html) out.html = decodeContent(body, cte, paramOf(ctRaw, "charset"));
  } else if (ct.startsWith("text/plain")) {
    if (!out.text) out.text = decodeContent(body, cte, paramOf(ctRaw, "charset"));
  }
}

function getHeader(hdrs, name) {
  const lines = hdrs.split(CRLF); const out = [];
  for (const ln of lines) { if ((ln.startsWith(" ") || ln.startsWith(TAB)) && out.length) out[out.length - 1] += " " + ln.trim(); else out.push(ln); }
  const low = name.toLowerCase() + ":";
  for (const ln of out) { if (ln.toLowerCase().startsWith(low)) return ln.slice(name.length + 1).trim(); }
  return "";
}

function decodeWords(s) {
  if (!s) return "";
  const OPEN = "=" + QM, CLOSE = QM + "=";
  let out = "", i = 0;
  while (i < s.length) {
    const o = s.indexOf(OPEN, i);
    if (o < 0) { out += s.slice(i); break; }
    out += s.slice(i, o);
    const c = s.indexOf(CLOSE, o + 2);
    if (c < 0) { out += s.slice(o); break; }
    const token = s.slice(o + 2, c);
    const parts = token.split(QM);
    if (parts.length >= 3) {
      const cs = parts[0].toLowerCase(); const en = parts[1].toUpperCase(); const tx = parts.slice(2).join(QM);
      try {
        let bytes;
        if (en === "B") { const bin = atob(tx.split(" ").join("")); bytes = Uint8Array.from(bin, (x) => x.charCodeAt(0)); }
        else { let t = ""; for (let k = 0; k < tx.length; k++) { const ch = tx[k]; if (ch === "_") t += " "; else if (ch === "=" && k + 2 < tx.length) { t += String.fromCharCode(parseInt(tx.substr(k + 1, 2), 16)); k += 2; } else t += ch; } bytes = Uint8Array.from(t, (x) => x.charCodeAt(0)); }
        out += new TextDecoder(cs).decode(bytes);
      } catch { out += token; }
    } else out += s.slice(o, c + 2);
    i = c + 2;
    let j = i; while (j < s.length && (s[j] === " " || s[j] === TAB)) j++;
    if (s.startsWith(OPEN, j)) i = j;
  }
  return out;
}

export { getHeader, decodeWords };
export function parseMessage(bytes) {
  // TextDecoder latin1 actually maps Windows-1252; preserve raw octets for MIME.
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const out = { text: '', html: '' };
  walk(raw, out, 0);
  return { corpo_texto: out.text.slice(0, 200000), corpo_html: out.html.slice(0, 400000) };
}