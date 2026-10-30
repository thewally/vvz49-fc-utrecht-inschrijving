// Verstuurt bevestigingsmails voor nieuwe inschrijvingen (draait in GitHub Actions).
import pg from 'pg';
import nodemailer from 'nodemailer';

const {
  NEON_DATABASE_URL, GMAIL_USER, GMAIL_APP_PASSWORD,
  MAIL_FROM_NAME = "VVZ'49", MAIL_REPLY_TO,
} = process.env;

const BUNQ = 'https://bunq.me/AvanderWal?amount={bedrag}&description={omschrijving}';
const WEDSTRIJD = 'FC Utrecht - Fortuna Sittard';
const DATUM = 'zaterdag 12 december 2026, 16:15 uur';

const euro = (n) => '€ ' + Number(n).toFixed(2).replace('.', ',');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const naam = (i) => [i.voornaam, i.tussenvoegsel, i.achternaam].filter(Boolean).join(' ');

function betaallink(i) {
  const omschrijving = `FC Utrecht vs Fortuna Sittard - ${naam(i)} ${i.referentie}`;
  return BUNQ.replace('{bedrag}', Number(i.totaal_bedrag).toFixed(2))
    .replace('{omschrijving}', encodeURIComponent(omschrijving).replace(/%20/g, '+'));
}

function mail(i, deelnemers) {
  const jong = deelnemers.filter(d => d.categorie === 't/m 15');
  const oud = deelnemers.filter(d => d.categorie === '16+');
  const spec = [];
  if (jong.length) spec.push([`${jong.length}× t/m 15 jaar à ${euro(12.5)}`, euro(jong.length * 12.5)]);
  if (oud.length) spec.push([`${oud.length}× vanaf 16 jaar à ${euro(19.5)}`, euro(oud.length * 19.5)]);
  const link = betaallink(i);

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#1f2a1f">
  <h2 style="color:#1B5E20">Bevestiging inschrijving ${WEDSTRIJD}</h2>
  <p>Beste ${esc(i.voornaam)},</p>
  <p>Bedankt voor je inschrijving voor <strong>${WEDSTRIJD}</strong> op ${DATUM}. Je referentie is <strong>${esc(i.referentie)}</strong>.</p>
  <h3 style="color:#1B5E20">Ingeschreven personen</h3>
  <table style="border-collapse:collapse;width:100%">
    ${deelnemers.map(d => `<tr><td style="padding:4px 0;border-bottom:1px solid #ddd">${esc(d.voornaam)} ${esc(d.achternaam)}</td>
      <td style="padding:4px 0;border-bottom:1px solid #ddd">${esc(d.team)}</td></tr>`).join('')}
  </table>
  <h3 style="color:#1B5E20">Te betalen</h3>
  <table style="border-collapse:collapse;width:100%">
    ${spec.map(([a, b]) => `<tr><td style="padding:4px 0">${a}</td><td style="text-align:right">${b}</td></tr>`).join('')}
    <tr><td style="padding:6px 0;border-top:2px solid #2E7D32"><strong>Totaal</strong></td>
      <td style="text-align:right;border-top:2px solid #2E7D32"><strong>${euro(i.totaal_bedrag)}</strong></td></tr>
  </table>
  <p>Heb je nog niet betaald? Dat kan via onderstaande knop:</p>
  <p><a href="${link}" style="background:#2E7D32;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Betaal ${euro(i.totaal_bedrag)} via bunq</a></p>
  <p>Sportieve groet,<br>VVZ'49</p>
</div>`;

  const text = `Beste ${i.voornaam},

Bedankt voor je inschrijving voor ${WEDSTRIJD} op ${DATUM}.
Referentie: ${i.referentie}

Ingeschreven personen:
${deelnemers.map(d => `- ${d.voornaam} ${d.achternaam} (${d.team})`).join('\n')}

Te betalen:
${spec.map(([a, b]) => `${a}: ${b}`).join('\n')}
Totaal: ${euro(i.totaal_bedrag)}

Nog niet betaald? ${link}

Sportieve groet,
VVZ'49`;

  return { html, text };
}

const db = new pg.Client({ connectionString: NEON_DATABASE_URL });
await db.connect();

const transport = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

const { rows } = await db.query(
  `select * from inschrijvingen where bevestiging_verstuurd_op is null order by aangemaakt_op limit 50`);
console.log(`${rows.length} nieuwe inschrijving(en)`);

let fouten = 0;
for (const i of rows) {
  const { rows: deelnemers } = await db.query(
    `select * from deelnemers where inschrijving_id = $1 order by achternaam, voornaam`, [i.id]);
  const { html, text } = mail(i, deelnemers);
  try {
    await transport.sendMail({
      from: `"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
      to: i.email,
      replyTo: MAIL_REPLY_TO || GMAIL_USER,
      subject: `Bevestiging inschrijving ${WEDSTRIJD} (${i.referentie})`,
      html, text,
    });
    await db.query(`update inschrijvingen set bevestiging_verstuurd_op = now() where id = $1`, [i.id]);
    console.log(`Verstuurd: ${i.referentie}`);
  } catch (err) {
    fouten++;
    console.error(`Mislukt: ${i.referentie}: ${err.message}`);
  }
}

await db.end();
if (fouten) process.exit(1);
