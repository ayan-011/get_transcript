# Transcript app (Next.js + Tailwind)

Upload audio or video, get a proofread transcript, copy it with one click.

## Run
1. `npm install`
2. `cp .env.example .env.local` and put your free Groq API key in it (get one at https://console.groq.com/keys, no card needed)
3. `npm run dev` → open http://localhost:3000

## How it works
- The browser decodes the file (video is reduced to its audio) and cuts it into 10-minute 16 kHz mono WAV parts.
- `/api/transcribe` sends each part to Groq's `whisper-large-v3`, passing the end of the previous part as context so names stay consistent.
- A Groq's `llama-3.3-70b-versatile` proofreading pass fixes spelling, punctuation and obvious mis-heard words without changing wording.
- The transcript is editable; use **Copy all** or **Download .txt**.

## Notes
- Deploying to Vercel: serverless request bodies are limited to ~4.5 MB, so lower `chunkSeconds` in `lib/audio.ts` (e.g. 120) or self-host with `npm run build && npm start`.
- Very large files (multi-GB video) are decoded in browser memory; keep them to a few hundred MB.

- Free-tier limits (Groq): about 2 hours of audio per hour and 20 requests per minute. If you hit a limit, wait a minute and retry.
- **Hinglish**: pick "Hinglish" to get Hindi written in English letters (e.g. "Maine khaana kha liya"). The audio is transcribed as Hindi, then rewritten in Roman letters; English words stay in English.
- **Change language without re-upload**: the converted audio stays in the browser tab, so you can switch the language and transcribe again. Refreshing the page clears it.
- **Playback**: the uploaded file is shown in an audio/video player so you can compare it with the transcript.
