# projectDNS2

Minimal grund för `Vite+ + React + TypeScript` i frontend och `Vercel serverless` i backend, med Neon PostgreSQL via `DATABASE_URL`.

## Vite+ toolchain

Projektet använder nu `Vite+` som primär toolchain för frontend-workflow.

- `vp dev` for frontend-devserver
- `vp build` for frontend-build
- `vp preview` for preview av frontend-build
- `vp check` for formattering, lint och type-aware checks via Vite+
- `vp lint` for enbart Vite+-lint
- `vp fmt` for enbart Vite+-formattering

Den nuvarande apparkitekturen är oförändrad:

- React SPA i `src/`
- Vercel serverless API i `api/`
- lokal backend/devserver i `server/dev-server.ts`
- Neon/PostgreSQL + Drizzle + RLS i backendlagret

Minimal migrering betyder här att projektstrukturen, backendupplägget och affärslogiken är bevarade, medan dev/build/check för frontend nu går via `Vite+`.

## Nuvarande scope

Projektet innehåller nu:

- cookie-baserad testsession via `app_session`
- server-side vald `active_organization_id`
- multitenant-grund med `users`, `organizations`, `organization_members`, `invitations`
- Drizzle migrationer och seed-data
- enkel dashboard
- forberedelser for PostgreSQL RLS

Det här steget har ocksa lagt till verkligt app-side db-context per request via:

- `pool.connect()`
- `BEGIN`
- `set_config('app.current_user_id', ...)`
- `set_config('app.current_organization_id', ...)`
- queries pa samma client
- `COMMIT` eller `ROLLBACK`
- `release()`

## Paket som används

- `react`, `react-dom`
- `vite`
- `vite-plus`
- `typescript`
- `pg`
- `drizzle-orm`
- `drizzle-kit`
- `vercel`

## .env.example

```env
DATABASE_URL=postgresql://USER:PASSWORD@YOUR-NEON-HOST/DBNAME?sslmode=require
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=ProjectDNS <onboarding@example.com>
SUPERVISOR_LOGIN_USERNAME=supervisor
SUPERVISOR_LOGIN_PASSWORD_HASH=scrypt:replace-with-random-salt:replace-with-derived-key-hex
SUPERVISOR_LOGIN_EMAIL=supervisor@example.com
SUPERVISOR_LOGIN_NAME=Supervisor
```

## Supervisor sign-in

The main sign-in flow is still passwordless email login.

There is also a smaller secondary supervisor sign-in that does not send email and uses:

- `SUPERVISOR_LOGIN_USERNAME`
- `SUPERVISOR_LOGIN_PASSWORD_HASH`
- `SUPERVISOR_LOGIN_EMAIL`
- `SUPERVISOR_LOGIN_NAME`

`SUPERVISOR_LOGIN_PASSWORD_HASH` must use the format `scrypt:salt:hash`, where:

- `salt` is a random string
- `hash` is the derived key encoded as hex

You can generate one with Node.js:

```bash
node -e "const { randomBytes, scryptSync } = require('node:crypto'); const password = process.argv[1]; const salt = randomBytes(16).toString('hex'); const hash = scryptSync(password, salt, 64).toString('hex'); console.log(`scrypt:${salt}:${hash}`);" "your-password"
```

## Resend setup

Invitation emails use Resend.

Required environment variables:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Example:

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=ProjectDNS <onboarding@example.com>
```

When an admin creates an invitation, the API now:

1. creates the invitation in the database
2. attempts to send an email via Resend
3. returns JSON either way

If the invitation is created but the email send fails, the invitation remains created and the response includes a clear `mail.error` value.

## PowerDNS setup

The first PowerDNS integration uses the PowerDNS HTTP API, not the PowerDNS database.

Required environment variables:

- `POWERDNS_API_URL`
- `POWERDNS_API_KEY`
- `POWERDNS_SERVER_ID`

Example:

```env
POWERDNS_API_URL=http://127.0.0.1:8081/api/v1
POWERDNS_API_KEY=your-powerdns-api-key
POWERDNS_SERVER_ID=localhost
```

Organization ownership stays in the application database via `dns_zones`.

The app stores:

- `organization_id`
- `name`
- `provider`
- `powerdns_zone_id`
- `created_by_user_id`

This keeps tenant isolation in Postgres/RLS while PowerDNS remains the external zone provider.

If PowerDNS is not reachable or not configured, `/api/zones` returns clear JSON errors and the rest of the app continues to work.

## PowerDNS zones rollout

The `dns_zones` migration is an application-owned table plus RLS policies. In the current setup, `DATABASE_URL` uses the least-privileged app role (`projectdns2_app`), so the migration should be applied with an admin/owner role, not the app role.

### Manual rollout of `dns_zones`

Run the SQL from `drizzle/0006_dns_zones.sql` with an admin role in Neon.

Exact SQL:

```sql
CREATE TABLE "dns_zones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "provider" text DEFAULT 'powerdns' NOT NULL,
  "powerdns_zone_id" text NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dns_zones_organization_id_name_unique" UNIQUE("organization_id", "name")
);

ALTER TABLE "dns_zones"
  ADD CONSTRAINT "dns_zones_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;

ALTER TABLE "dns_zones"
  ADD CONSTRAINT "dns_zones_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;

CREATE INDEX "dns_zones_organization_id_idx"
  ON "dns_zones" USING btree ("organization_id");

ALTER TABLE "dns_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dns_zones" FORCE ROW LEVEL SECURITY;

CREATE POLICY "dns_zones_select_policy" ON "dns_zones"
FOR SELECT
USING (
  public.is_organization_member(
    dns_zones.organization_id,
    NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
);

CREATE POLICY "dns_zones_insert_policy" ON "dns_zones"
FOR INSERT
WITH CHECK (
  organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  AND created_by_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
);
```

### Grants needed for the app role

After the migration is applied with the admin role, grant the app role access:

```sql
grant select, insert on dns_zones to projectdns2_app;
```

### Local env for PowerDNS

Add these values to local `.env`:

```env
POWERDNS_API_URL=http://127.0.0.1:8081/api/v1
POWERDNS_API_KEY=your-powerdns-api-key
POWERDNS_SERVER_ID=localhost
```

### Vercel env for PowerDNS

Add these variables to Vercel:

- `POWERDNS_API_URL`
- `POWERDNS_API_KEY`
- `POWERDNS_SERVER_ID`

### Verification order after rollout

1. Apply the `dns_zones` SQL with an admin role in Neon
2. Run:

```sql
grant select, insert on dns_zones to projectdns2_app;
```

3. Set PowerDNS env locally and in Vercel
4. Verify `GET /api/zones`
5. Verify `POST /api/zones`
6. Confirm that the created zone exists:
   - in PowerDNS via HTTP API
   - in app Postgres via `dns_zones`
7. Verify that zones only appear for the correct organization via session + RLS

## Lokal setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
npm run dev:local
```

## Dagliga kommandon

Frontend och toolchain:

```bash
npm run dev
npm run build
npm run preview
npm run check
npm run lint
npm run fmt
npm run typecheck
```

Databas och lokal backend:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:verify-rls
npm run dev:local
npm run dev:vercel
```

Direkt med Vite+:

```bash
vp dev
vp build
vp preview
vp check
vp lint
vp fmt
```

## Session och tenant cookies

Systemet använder nu:

- `app_session`
  - `HttpOnly`
  - `Secure`
  - `SameSite=Lax`
  - `Path=/`
- `active_organization_id`
  - sätts server-side via `POST /api/session/active-organization`

Frontend använder `GET /api/session` som source of truth för:

- current user
- memberships
- active organization

## RLS-context per request

Tenant-kansliga endpoints satter nu db-context pa samma PostgreSQL-connection som queryn kor pa:

```sql
select set_config('app.current_user_id', $1, true)
select set_config('app.current_organization_id', $2, true)
```

Det sker inne i en transaktion per request.

## RLS-status

RLS har aktiverats i migration pa:

- `organizations`
- `organization_members`
- `invitations`

Policies finns for:

- `SELECT` pa alla tre tabeller
- `INSERT` for de floden som appen redan anvander

## Verklig RLS-enforcement

Diagnosen ar nu tydlig:

- appen anslot via `neondb_owner`
- rollen hade `rolbypassrls = true`
- tabellerna hade forst `ENABLE ROW LEVEL SECURITY`
- och sedan `FORCE ROW LEVEL SECURITY`
- men PostgreSQL-roller med `BYPASSRLS` bypassar fortfarande policies i den nuvarande setupen

Det betyder att verklig enforcement kraver en separat app-roll utan `BYPASSRLS`.

## SQL att kora i Neon

Skapa en enkel app-roll med `LOGIN` och without `BYPASSRLS`:

```sql
create role projectdns2_app
with
  login
  password 'SET_A_STRONG_PASSWORD_HERE'
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication;
```

Verifiera att rollen inte bypassar RLS:

```sql
select rolname, rolbypassrls
from pg_roles
where rolname = 'projectdns2_app';
```

Ge schema-atkomst:

```sql
grant usage on schema public to projectdns2_app;
```

Ge minsta nojdvandiga tabellrattigheter for appens nuvarande floden:

```sql
grant select, insert, update on users to projectdns2_app;
grant select, insert, delete on user_sessions to projectdns2_app;
grant select, insert, delete on login_tokens to projectdns2_app;

grant select, insert on organizations to projectdns2_app;
grant select, insert on organization_members to projectdns2_app;
grant select, insert, update on invitations to projectdns2_app;
grant select, insert on dns_zones to projectdns2_app;
```

Kontrollera att tabellerna fortsatt ags av `neondb_owner` och inte av app-rollen:

```sql
select schemaname, tablename, tableowner
from pg_tables
where schemaname = 'public'
  and tablename in ('users', 'user_sessions', 'organizations', 'organization_members', 'invitations')
order by tablename;
```

Om `dns_zones` ar migrerad i miljo:n, inkludera aven den i samma kontroll:

```sql
select schemaname, tablename, tableowner
from pg_tables
where schemaname = 'public'
  and tablename in ('users', 'user_sessions', 'organizations', 'organization_members', 'invitations', 'dns_zones')
order by tablename;
```

## Ny DATABASE_URL

Byt `DATABASE_URL` sa att appen ansluter som `projectdns2_app` i stallet for `neondb_owner`.

Exempel:

```env
DATABASE_URL=postgresql://projectdns2_app:SET_A_STRONG_PASSWORD_HERE@YOUR-NEON-HOST/DATABASE_NAME?sslmode=require
```

## Lokalt byte av DATABASE_URL

1. Oppna `.env`
2. Ersatt befintlig `DATABASE_URL`
3. Spara filen
4. Kor verifiering igen:

```bash
npm run db:verify-rls
```

## Vercel byte av DATABASE_URL

1. Oppna Vercel-projektets Environment Variables
2. Ersatt `DATABASE_URL` med den nya app-rollens anslutningsstrang
3. Redeploya projektet

## Exakt verifieringsordning efter rollbytet

1. Kor SQL i Neon for att skapa `projectdns2_app`
2. Kor SQL i Neon for `GRANT`s enligt ovan
3. Byt `DATABASE_URL` lokalt till app-rollen
4. Kor:

```bash
npm run db:verify-rls
```

Forvantat resultat:

- user A kan lasa `test-organization` men inte `second-organization`
- user A kan lasa `invited.person@example.com` men inte `second-invite@example.com`
- user A far tomt resultat for members i `second-organization`
- user A kan bara lasa `dns_zones` for sin egen organization
- user B kan lasa `second-organization` men inte `test-organization`
- user B kan lasa `second-invite@example.com` men inte `invited.person@example.com`
- user B kan bara lasa `dns_zones` for sin egen organization

Om `dns_zones`-tabellen finns men inga zoner ar skapade annu ar ett tomt resultat fortfarande korrekt. Det viktiga i verifieringen ar att inga zoner fran en annan organization exponeras.

## Viktig begransning just nu

Databasen visar fortfarande att den nuvarande anslutningsrollen kan lasa over tenant-granser trots att RLS-migrationen ar applicerad.

Det betyder att RLS-policyerna ar definierade och appen satter korrekt Postgres session context, men att den databasroll som `DATABASE_URL` anvander fortfarande bypassar RLS.

Det som redan ar klart:

- appen satter korrekt db-context per request
- migrationerna for RLS finns
- seed med tva users och tva organizations finns
- verifieringsscript finns

Det som aterstar for full verklig databassakerhet:

- kora appqueries som en roll som inte bypassar RLS

## Verifieringskommandon

```bash
npm run db:migrate
npm run db:seed
npm run db:verify-rls
npm run build
npm run check
npm run lint
npm run typecheck
npm run dev
npm run dev:local
```

## Vad `db:verify-rls` gor

Scriptet satter:

- `app.current_user_id`
- `app.current_organization_id`

och forsoker lasa `organizations`, `organization_members`, `invitations` och `dns_zones` som tva olika users.

Scriptet visar nu tydlig `overallPass: true/false` samt `expected` kontra `actual` for:

- first user i `test-organization`
- second user i `second-organization`

Om `overallPass` ar `false` efter rollbytet ar RLS fortfarande inte enforced korrekt.
