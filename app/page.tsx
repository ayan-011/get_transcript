"use client";

import { useEffect, useRef, useState } from "react";
import { fileToWavChunks } from "@/lib/audio";

const LANGUAGES = [
  { code: "", label: "Auto-detect" }, { code: "en", label: "English" }, { code: "hi", label: "Hindi (देवनागरी)" },
  { code: "hinglish", label: "Hinglish (Hindi in English letters)" },
  { code: "es", label: "Spanish" }, { code: "fr", label: "French" }, { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" }, { code: "ar", label: "Arabic" }, { code: "ja", label: "Japanese" },
];

type Status = "idle" | "working" | "done" | "error";

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const chunksRef = useRef<Blob[] | null>(null); // audio kept in memory so language can change without re-upload
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [language, setLanguage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Playable copy of the uploaded file
  useEffect(() => {
    if (!file) { setMediaUrl(""); return; }
    const url = URL.createObjectURL(file);
    setMediaUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isVideo = !!file && (file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(file.name));

  function pick(f: File | undefined | null) {
    if (!f) return;
    if (!/^(audio|video)\//.test(f.type) && !/\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|mkv)$/i.test(f.name)) {
      setStatus("error"); setMessage("Choose an audio or video file."); return;
    }
    chunksRef.current = null;
    setFile(f); setStatus("idle"); setMessage(""); setTranscript(""); setEdited(false);
  }

  async function run() {
    if (!file) return;
    if (edited && !window.confirm("Your manual edits will be replaced by the new transcript. Continue?")) return;
    setStatus("working"); setProgress(0); setTranscript(""); setEdited(false);
    try {
      if (!chunksRef.current) {
        setMessage("Reading audio from your file…");
        chunksRef.current = await fileToWavChunks(file);
      }
      const chunks = chunksRef.current;
      let full = "";
      for (let i = 0; i < chunks.length; i++) {
        setMessage(chunks.length > 1 ? `Transcribing part ${i + 1} of ${chunks.length}…` : "Transcribing and checking spelling…");
        const body = new FormData();
        body.append("file", chunks[i], `part-${i}.wav`);
        if (language) body.append("language", language);
        if (full) body.append("context", full.slice(-300));
        const res = await fetch("/api/transcribe", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Something went wrong.");
        full += (full ? "\n\n" : "") + data.text;
        setTranscript(full);
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
      }
      setStatus("done");
    } catch (e: any) {
      setStatus("error"); setMessage(e.message || "Something went wrong.");
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([transcript], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = (file?.name.replace(/\.[^.]+$/, "") || "transcript") + ".txt"; a.click();
    URL.revokeObjectURL(url);
  }

  const busy = status === "working";
  const hasTranscript = !!transcript;

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Turn a recording into text</h1>
      <p className="mt-3 max-w-xl text-base text-ink/70">
        Upload a voice note, call, lecture or video. You get a clean transcript with spelling already checked.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); }}
        className={`mt-8 rounded-xl border-2 border-dashed bg-white p-8 text-center transition-colors ${dragging ? "border-teal bg-teal/5" : "border-line"}`}
      >
        <input ref={inputRef} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <p className="break-all font-medium">{file.name} <span className="font-normal text-ink/60">({(file.size / 1048576).toFixed(1)} MB)</span></p>
        ) : (
          <p className="text-ink/70">Drop an audio or video file here</p>
        )}
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-4 rounded-lg border border-line bg-mist px-4 py-2 text-sm font-medium hover:bg-line/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal disabled:opacity-50"
        >
          {file ? "Choose a different file" : "Choose file"}
        </button>
        <p className="mt-3 text-xs text-ink/50">MP3, WAV, M4A, MP4, MOV, WebM and more</p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Language
          <select
            value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
          >
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <button
          onClick={run}
          disabled={!file || busy}
          className="ml-auto rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Working…" : hasTranscript ? "Transcribe again in this language" : "Get transcript"}
        </button>
      </div>
      {hasTranscript && !busy && (
        <p className="mt-2 text-sm text-ink/60">Wrong language? Change it above and transcribe again. Your file doesn’t need to be uploaded again.</p>
      )}

      {busy && (
        <div className="mt-6" role="status">
          <p className="text-sm text-ink/70">{message}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-teal transition-all duration-500" style={{ width: `${Math.max(progress, 6)}%` }} />
          </div>
        </div>
      )}

      {status === "error" && (
        <p role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message}</p>
      )}

      {file && mediaUrl && (
        <section className="mt-8 rounded-xl border border-line bg-white p-4">
          <h2 className="mb-3 font-semibold">Your recording</h2>
          {isVideo ? (
            <video src={mediaUrl} controls className="max-h-80 w-full rounded-lg bg-black" />
          ) : (
            <audio src={mediaUrl} controls className="w-full" />
          )}
          <p className="mt-2 text-xs text-ink/50">Play it while reading the transcript below to check the words.</p>
        </section>
      )}

      {hasTranscript && (
        <section className="mt-6 rounded-xl border border-line bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-semibold">Transcript</h2>
            <div className="flex gap-2">
              <button onClick={download} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-mist focus:outline-none focus-visible:ring-2 focus-visible:ring-teal">
                Download .txt
              </button>
              <button onClick={copy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal">
                {copied ? "Copied" : "Copy all"}
              </button>
            </div>
          </div>
          <textarea
            value={transcript} onChange={(e) => { setTranscript(e.target.value); setEdited(true); }}
            className="block h-96 w-full resize-y rounded-b-xl p-4 text-[15px] leading-7 focus:outline-none"
            aria-label="Transcript text, editable"
          />
        </section>
      )}
    </main>
  );
}
