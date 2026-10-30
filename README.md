# VVZ'49 – Inschrijving FC Utrecht - Fortuna Sittard

Inschrijfformulier en beheerpagina voor de clubuitje naar **FC Utrecht - Fortuna Sittard** (zaterdag 12 december 2026, 16:15 uur).

- **Formulier:** `https://thewally.github.io/vvz49-fc-utrecht-inschrijving/`
- **Beheer:** `https://thewally.github.io/vvz49-fc-utrecht-inschrijving/beheer.html`

## Hoe het werkt

| Onderdeel | Wat |
|---|---|
| `site/` | Statische site op GitHub Pages (formulier + beheer) |
| `db/001_schema.sql` | Tabellen, prijslogica en functies in Neon |
| Neon Data API | De site roept alleen de functies `teams`, `registreer`, `beheer_overzicht` en `beheer_zet_betaald` aan. Tabellen zijn niet direct leesbaar. |
| `send-mails.yml` | Elke ~5 minuten: bevestigingsmail via Gmail naar nieuwe inschrijvers |
| `migrate.yml` | Voert de SQL uit en zet het beheerwachtwoord |
| `deploy-pages.yml` | Publiceert `site/` naar GitHub Pages |

Tarieven: vanaf 16 jaar € 19,50, t/m 15 jaar € 12,50. Leeftijd geteld op 12-12-2026. Het bedrag wordt in de database berekend.

## Eenmalige installatie

1. **Neon**
   - Maak een project aan op <https://console.neon.tech>.
   - Zet onder *Data API* de Data API aan en voeg onder *Settings → Postgres → Data API → Add provider* de JWKS URL `https://thewally.github.io/vvz49-fc-utrecht-inschrijving/jwks.json` toe.
   - Kopieer de *API URL* voor de secret `NEON_DATA_API_URL` hieronder.
   - Kopieer de connection string (rol `neondb_owner`) voor de secret hieronder.
2. **Gmail**: maak een app-wachtwoord aan via <https://myaccount.google.com/apppasswords> (vereist 2-staps­verificatie).
3. **GitHub Secrets** (*Settings → Secrets and variables → Actions*):
   - `NEON_DATABASE_URL` – connection string van `neondb_owner` (alleen gebruikt door Actions)
   - `NEON_DATA_API_URL` – Data API URL (wordt bij de deploy in `config.js` gezet)
   - `JWT_PRIVATE_KEY` – RSA-privésleutel waarmee de deploy het anonieme token ondertekent
   - `BEHEER_WACHTWOORD` – wachtwoord voor de beheerpagina
   - `GMAIL_USER` – Gmail-adres van de afzender
   - `GMAIL_APP_PASSWORD` – het app-wachtwoord
4. **GitHub Pages**: *Settings → Pages → Source: GitHub Actions*.
5. Start de workflows **Database migreren** en **Deploy naar GitHub Pages** (tab *Actions → Run workflow*).

## Aanpassen

- **Inleidende tekst stap 1:** `site/intro.html`
- **Prijzen, betaallink, teksten:** `site/config.js` (prijzen ook in `db/001_schema.sql` en de mail in `scripts/send-confirmations.mjs`)
- **Teams:** de `insert into teams` in `db/001_schema.sql`

## Na afloop (AVG)

Verwijder de gegevens na het evenement, bijvoorbeeld met `delete from inschrijvingen;` in de Neon SQL Editor.
