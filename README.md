# Auto SRT + Voice Over (Gemini, Local PC)

Aplikasi lokal untuk otomatisasi:
- input: `video + judul + deskripsi + affiliate link`
- output per style: `.srt`, `.wav` (24kHz mono), `.mp4` final (voice-over + subtitle burn-in, audio asli source dimute), dan `caption + hashtags` siap upload Facebook Reels (juga tersimpan sebagai file `.txt`)
- style default: `evergreen`, `soft_selling`, `hard_selling`, `problem_solution`

## Stack
- Frontend: React + Vite + TypeScript
- Backend: Fastify + TypeScript
- AI: Gemini (`@google/genai`)
- Media: `ffmpeg-static` + `ffprobe-static` (tanpa install FFmpeg global)

## Struktur
- `apps/server`: API lokal + job processor
- `apps/web`: UI lokal
- `data/settings.json`: konfigurasi model/prompt/voice
- `data/jobs.json`: metadata 20 job terakhir
- `outputs/<jobId>`: file hasil `.srt`, `.wav`, `.mp4`, dan `*-caption.txt`
- `uploads/<jobId>`: video source upload
- `edits/<sessionId>`: clip editor + `preview.mp4`

## Setup
1. Install dependency:
```bash
npm install
```
2. Buat `.env` dari contoh:
```bash
copy .env.example .env
```
3. Isi `GEMINI_API_KEY` di `.env`.

## Menjalankan (dev)
```bash
npm run dev
```

Default:
- Backend API: `http://localhost:8787`
- Frontend UI: `http://localhost:5173`

Alternatif (Windows launcher):
- `start-dev.bat`: jalankan server + frontend bersamaan
- `start-server.bat`: jalankan server saja
- `start-frontend.bat`: jalankan frontend saja

## Menjalankan (build + start)
```bash
npm run build
npm run start
```

## Endpoint API
- `GET /api/health`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/jobs` (multipart):
  - wajib: `title`, `description`, `affiliateLink`, `styleId`, `sourceType`
  - jika `sourceType=upload`: kirim `video`
  - jika `sourceType=editing`: kirim `editSessionId` (preview harus sudah dirender)
- `GET /api/jobs`
- `GET /api/jobs/:jobId`
- `POST /api/jobs/:jobId/retry` body `{ "styleId": "evergreen" | "soft_selling" | "hard_selling" | "problem_solution" }`
- `POST /api/jobs/:jobId/open-location` body `{ "styleId": "evergreen" | "soft_selling" | "hard_selling" | "problem_solution" }`
- `POST /api/editor/session`
- `GET /api/editor/:sessionId`
- `POST /api/editor/:sessionId/clips`
- `PUT /api/editor/:sessionId/timeline`
- `POST /api/editor/:sessionId/render-preview`
- `DELETE /api/editor/:sessionId`

## Catatan Operasional
- Maks durasi video default: 60 detik (ubah di settings).
- Proses style berjalan berurutan (sequential).
- Jika satu style gagal, style lain tetap lanjut.
- Riwayat job otomatis dipangkas maksimal 20 entry.
- Log tersimpan di `logs/app.log`.
- Tombol output di UI membuka folder hasil (`Open File Location`) alih-alih download langsung.
- Halaman `Generate` punya 2 source:
  - `Editing`: editor multi-clip (trim, urutkan, render preview)
  - `Upload`: upload video langsung
- Clip timeline wajib durasi minimal 5 detik per clip.
- Tab `Jobs` menampilkan caption final siap copy serta tombol copy affiliate link.

## Testing
```bash
npm run test
```
