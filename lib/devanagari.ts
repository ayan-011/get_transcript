// Built-in Hindi (Devanagari) -> Roman "Hinglish" converter.
// Used as a safety net when the AI conversion fails, so the output is never Devanagari.

const INDEP: Record<string, string> = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri",
  "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e",
};
const MATRA: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e",
};
const CONS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "f", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
};
const NUKTA_MAP: Record<string, string> = { "क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f" };
const HALANT = "्", NUKTA = "़";
const NASAL = new Set(["ं", "ँ"]);
const DIGITS = "०१२३४५६७८९";

type Syl = { c: string; v: string; fixed: boolean; s: string };

function convertWord(word: string): string {
  const chars = [...word];
  const syl: Syl[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (INDEP[ch]) {
      syl.push({ c: "", v: INDEP[ch], fixed: true, s: "" });
    } else if (CONS[ch]) {
      let c = CONS[ch];
      if (chars[i + 1] === NUKTA) { c = NUKTA_MAP[ch] ?? c; i++; }
      const next = chars[i + 1];
      if (next === HALANT) { syl.push({ c, v: "", fixed: true, s: "" }); i++; }
      else if (next && MATRA[next]) { syl.push({ c, v: MATRA[next], fixed: true, s: "" }); i++; }
      else syl.push({ c, v: "a", fixed: false, s: "" });
    } else if (NASAL.has(ch) && syl.length) {
      syl[syl.length - 1].s += "n";
    } else if (ch === "ः" && syl.length) {
      syl[syl.length - 1].s += "h";
    }
  }
  // Schwa deletion, right to left: "सबसे" -> "sabse", "समझना" -> "samajhna"
  const last = syl.length - 1;
  for (let i = last; i >= 1; i--) {
    const s = syl[i];
    if (s.fixed) continue;
    if (i === last) { s.v = ""; continue; }
    if (syl[i - 1].v !== "" && syl[i + 1].v !== "") s.v = "";
  }
  // Chat-style word endings: khaana (not khaanaa), jaankaari (not jaankaaree)
  const end = syl[last];
  if (end && end.c && end.fixed) {
    if (end.v === "aa") end.v = "a";
    else if (end.v === "ee") end.v = "i";
  }
  return syl.map((s) => s.c + s.v + s.s).join("");
}

export function transliterateDevanagari(text: string): string {
  const out = text
    .normalize("NFD")
    .replace(/[\u0900-\u0963]+/g, convertWord)
    .replace(/[।॥]/g, ".")
    .replace(/[०-९]/g, (d) => String(DIGITS.indexOf(d)));
  // Capitalise the first letter of each sentence
  return out.replace(/(^|[.?!]\s+|\n\s*)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}