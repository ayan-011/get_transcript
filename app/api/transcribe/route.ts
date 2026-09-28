import { NextRequest, NextResponse } from "next/server";
import { transliterateDevanagari } from "@/lib/devanagari";

export const runtime = "nodejs";
export const maxDuration = 300;

// Groq offers a free tier (no card needed) with an OpenAI-compatible API.
const GROQ = "https://api.groq.com/openai/v1";
const STT_MODEL = "whisper-large-v3"; // most accurate
const CHAT_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]; // second one is a backup
const DEVANAGARI = /[\u0900-\u097F]/;
const GAP_SECONDS = 15; // silent gaps longer than this are re-checked

type Seg = { start: number; end: number; text: string; no_speech_prob?: number; avg_logprob?: number };
type Msg = { role: "system" | "user" | "assistant"; content: string };
type SttOpts = { language: string; prompt: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/* ---------------- Speech to text ---------------- */

async function whisper(wav: Buffer, opts: SttOpts, key: string): Promise<Seg[]> {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
  fd.append("model", STT_MODEL);
  fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "segment");
  fd.append("temperature", "0");
  if (opts.language) fd.append("language", opts.language);
  if (opts.prompt) fd.append("prompt", opts.prompt);

  const res = await fetch(`${GROQ}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
  if (!res.ok) {
    const err = new Error(res.status === 429 ? "Free-tier limit reached. Wait a minute and try again." : `Transcription failed: ${await res.text()}`);
    (err as any).status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const data = await res.json();
  const segs: Seg[] = (data.segments ?? []).map((s: any) => ({
    start: s.start, end: s.end, text: String(s.text ?? "").trim(),
    no_speech_prob: s.no_speech_prob, avg_logprob: s.avg_logprob,
  }));
  if (!segs.length && data.text) segs.push({ start: 0, end: 0, text: String(data.text).trim() });
  // Drop segments Whisper itself flags as silence/noise (these are usually hallucinations)
  return segs.filter((s) => s.text && !((s.no_speech_prob ?? 0) > 0.8 && (s.avg_logprob ?? 0) < -1));
}

function wavFromPcm(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Whisper sometimes skips stretches of speech. Find long gaps and transcribe just those parts again.
async function recoverGaps(wav: Buffer, segs: Seg[], opts: SttOpts, key: string): Promise<Seg[]> {
  const isOurWav = wav.length > 44 && wav.toString("ascii", 0, 4) === "RIFF" && wav.readUInt32LE(24) === 16000;
  if (!isOurWav) return segs;
  const duration = (wav.length - 44) / 32000;
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const gaps: [number, number][] = [];
  let prevEnd = 0;
  for (const s of sorted) {
    if (s.start - prevEnd > GAP_SECONDS) gaps.push([prevEnd, s.start]);
    prevEnd = Math.max(prevEnd, s.end);
  }
  if (duration - prevEnd > GAP_SECONDS) gaps.push([prevEnd, duration]);

  const extra: Seg[] = [];
  for (const [from, to] of gaps.slice(0, 6)) {
    try {
      const a = Math.floor(from * 16000) * 2 + 44;
      const b = Math.min(wav.length, Math.floor(to * 16000) * 2 + 44);
      const found = await whisper(wavFromPcm(wav.subarray(a, b)), { ...opts, prompt: "" }, key);
      for (const s of found) extra.push({ ...s, start: s.start + from, end: s.end + from });
    } catch { /* keep going without this gap */ }
  }
  return [...segs, ...extra].sort((x, y) => x.start - y.start);
}

/* ---------------- Text clean-up ---------------- */

async function ask(model: string, messages: Msg[], key: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${GROQ}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0, messages }),
      });
      if (res.status === 429 && attempt === 0) { await sleep(2500); continue; }
      if (!res.ok) return null;
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }
  return null;
}

const HINGLISH_SYSTEM = `You convert Hindi speech transcripts into natural Hinglish: Hindi words written in Roman (English) letters, exactly the way people type on WhatsApp.
Rules:
- Convert EVERY sentence. Never skip, shorten, summarise or add anything.
- Never translate Hindi words into English. Keep the same words and word order.
- Never use Devanagari letters in the output.
- Words that are English (or borrowed English like फास्ट, इंटरनेट, यूट्यूबर, मोबाइल) must be written in normal English spelling: fast, internet, YouTuber, mobile.
- Use common chat spellings: hai, hain, nahi, kya, aur, mera, aap, toh, yeh, woh, kaise, bahut.
- Use normal punctuation and capital letters at the start of sentences.
- Reply with the converted text only.`;

const HINGLISH_EXAMPLES: Msg[] = [
  { role: "user", content: "आज हम देखेंगे कि सबसे फास्ट इंटरनेट किस टेक यूट्यूबर पे है?" },
  { role: "assistant", content: "Aaj hum dekhenge ki sabse fast internet kis tech YouTuber pe hai?" },
  { role: "user", content: "मैंने खाना खा लिया। फिर हम मार्केट गए और नया मोबाइल खरीदा।" },
  { role: "assistant", content: "Maine khaana kha liya. Phir hum market gaye aur naya mobile kharida." },
  { role: "user", content: "अगर आपको यह वीडियो पसंद आया तो लाइक और सब्सक्राइब जरूर करना।" },
  { role: "assistant", content: "Agar aapko yeh video pasand aaya toh like aur subscribe zaroor karna." },
];

function splitPieces(text: string, max = 600): string[] {
  const sentences = text.match(/[^।.?!\n]+[।.?!]*\s*/g) ?? [text];
  const pieces: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) { pieces.push(cur); cur = ""; }
    cur += s;
  }
  if (cur.trim()) pieces.push(cur);
  return pieces;
}

async function toHinglish(text: string, key: string): Promise<string> {
  const out: string[] = [];
  for (const piece of splitPieces(text)) {
    let done: string | null = null;
    if (DEVANAGARI.test(piece)) {
      for (const model of CHAT_MODELS) {
        const r = await ask(model, [{ role: "system", content: HINGLISH_SYSTEM }, ...HINGLISH_EXAMPLES, { role: "user", content: piece.trim() }], key);
        // Accept only if it is fully Roman and nothing went missing
        if (r && !DEVANAGARI.test(r) && wordCount(r) >= wordCount(piece) * 0.75) { done = r; break; }
      }
      if (!done) done = transliterateDevanagari(piece).trim(); // safety net: never return Devanagari
    } else {
      done = piece.trim(); // already Roman/English
    }
    out.push(done);
  }
  return out.join(" ").replace(/ {2,}/g, " ");
}

async function proofread(text: string, key: string): Promise<string> {
  if (!text.trim()) return text;
  const system =
    "You proofread speech transcripts. Fix spelling mistakes, wrongly recognised words that are obvious from context, capitalisation, punctuation and paragraph breaks. Keep the same language and script as the input. Do NOT translate, summarise, add or remove content, or change the speaker's wording. Return only the corrected transcript, with no comments.";
  const r = await ask(CHAT_MODELS[0], [{ role: "system", content: system }, { role: "user", content: text }], key);
  return r && r.length >= text.length * 0.7 ? r : text;
}

/* ---------------- Route ---------------- */

export async function POST(req: NextRequest) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return NextResponse.json({ error: "GROQ_API_KEY is missing. Add it to .env.local and restart the server." }, { status: 500 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No audio received." }, { status: 400 });

  const language = String(form.get("language") ?? "");
  const hinglish = language === "hinglish";
  const context = String(form.get("context") ?? "").slice(-200);
  // Hinglish = Hindi speech. Whisper listens in Hindi (no prompt, so it can't get confused), then we write it in Roman letters.
  const opts: SttOpts = { language: hinglish ? "hi" : language, prompt: hinglish ? "" : context };

  try {
    const wav = Buffer.from(await file.arrayBuffer());
    let segs = await whisper(wav, opts, key);
    segs = await recoverGaps(wav, segs, opts, key);
    const raw = segs.map((s) => s.text).join(" ").replace(/ {2,}/g, " ").trim();
    const text = hinglish ? await toHinglish(raw, key) : await proofread(raw, key);
    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Something went wrong." }, { status: e.status || 500 });
  }
}