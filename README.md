# projectDNS2

Minimal grund för `Vite + React + TypeScript` i frontend och `Vercel serverless` i backend, med Neon PostgreSQL via `DATABASE_URL`.

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

## Lokal setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev:local
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
grant select on users to projectdns2_app;
grant select on user_sessions to projectdns2_app;

grant select, insert on organizations to projectdns2_app;
grant select, insert on organization_members to projectdns2_app;
grant select, insert, update on invitations to projectdns2_app;
```

Kontrollera att tabellerna fortsatt ags av `neondb_owner` och inte av app-rollen:

```sql
select schemaname, tablename, tableowner
from pg_tables
where schemaname = 'public'
  and tablename in ('users', 'user_sessions', 'organizations', 'organization_members', 'invitations')
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
- user B kan lasa `second-organization` men inte `test-organization`
- user B kan lasa `second-invite@example.com` men inte `invited.person@example.com`

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
npm run lint
npm run dev:local
```

## Vad `db:verify-rls` gor

Scriptet satter:

- `app.current_user_id`
- `app.current_organization_id`

och forsoker lasa `organizations`, `organization_members` och `invitations` som tva olika users.

Scriptet visar nu tydlig `overallPass: true/false` samt `expected` kontra `actual` for:

- first user i `test-organization`
- second user i `second-organization`

Om `overallPass` ar `false` efter rollbytet ar RLS fortfarande inte enforced korrekt.
