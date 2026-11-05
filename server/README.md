# MyApp server

Standalone Express API for the Expo app. Uses the same MySQL database as MQ-Coach-App (`appmarcos_mainapp`) and the same uploads folder.

## Run

```bash
cd "C:\Users\User\Desktop\All Project\App\MyApp\server"
npm install
npm start
```

Dev (auto-restart):

```bash
npm run dev
```

Default port: **4000** (MQ-Coach-App stays on 3000).

## Env

See `.env` — `DB_*`, `JWT_SECRET`, `GEMINI_API_KEY`, `UPLOADS_DIR`, `PORT`.

## Regenerate ported handlers

```bash
node tools/build_legacy.js
```
