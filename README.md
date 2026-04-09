# projectDNS2

Minimal grund för `Vite + React + TypeScript` i frontend och `Vercel serverless` i backend, med Neon PostgreSQL via `DATABASE_URL`.

## Mål

Projektet verifierar en enkel end-to-end kedja:

`frontend -> /api/health och /api/db-check -> Neon PostgreSQL`

Det här är medvetet minsta fungerande version. Ingen auth, inga organizations, inga invitations, ingen Resend, ingen PowerDNS och ingen RLS ingår ännu.

## Paket som används

- `react`, `react-dom`
- `vite`
- `typescript`
- `@neondatabase/serverless`
- `vercel`

## Projektstruktur

```text
.
├── api/
│   ├── db-check.ts
│   └── health.ts
├── lib/
│   └── db.ts
├── src/
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── .env.example
├── package.json
├── vercel.json
└── vite.config.ts
```

## .env.example

```env
DATABASE_URL=postgresql://USER:PASSWORD@YOUR-NEON-HOST/DBNAME?sslmode=require
```

Skapa sedan en lokal `.env` med din riktiga Neon-anslutningssträng.

## Lokal setup

1. Installera beroenden:

```bash
npm install
```

2. Skapa `.env` från exemplet och fyll i din Neon-URL:

```bash
cp .env.example .env
```

3. Starta Vercel serverless lokalt:

```bash
npm run dev:vercel
```

4. Öppna appen i browsern på adressen som Vercel CLI visar, normalt `http://localhost:3000`.

## Lokal verifiering

När allt fungerar ska du kunna verifiera:

- `GET /api/health` returnerar `200` och `ok: true`
- `GET /api/db-check` returnerar `200` och `ok: true` när `DATABASE_URL` är satt korrekt
- startsidan visar både `Health status` och `DB status`

Om `DATABASE_URL` saknas eller är felaktig returnerar `/api/db-check` ett tydligt felmeddelande och startsidan visar felet.
