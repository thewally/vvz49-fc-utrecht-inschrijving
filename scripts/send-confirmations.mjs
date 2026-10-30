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

function betaallink(i, bedrag = i.totaal_bedrag, extra = '') {
  const omschrijving = `FC Utrecht vs Fortuna Sittard - ${naam(i)} ${i.referentie}${extra}`;
  return BUNQ.replace('{bedrag}', Number(bedrag).toFixed(2))
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

// ---------- aanvullende betaalverzoeken ----------
function verzoekMail(i, v) {
  const link = betaallink(i, v.bedrag, ' aanvulling');
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#1f2a1f">
  <h2 style="color:#1B5E20">Aanvullend betaalverzoek ${WEDSTRIJD}</h2>
  <p>Beste ${esc(i.voornaam)},</p>
  <p>Je inschrijving <strong>${esc(i.referentie)}</strong> is aangepast:</p>
  <p>${esc(v.toelichting)}</p>
  <p>Het nog te betalen bedrag is <strong>${euro(v.bedrag)}</strong>.</p>
  <p><a href="${link}" style="background:#2E7D32;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Betaal ${euro(v.bedrag)} via bunq</a></p>
  <p>Het totaal van je inschrijving is nu ${euro(i.totaal_bedrag)}.</p>
  <p>Sportieve groet,<br>VVZ'49</p>
</div>`;
  const text = `Beste ${i.voornaam},

Je inschrijving ${i.referentie} voor ${WEDSTRIJD} is aangepast:
${v.toelichting}

Nog te betalen: ${euro(v.bedrag)}
Betalen: ${link}

Het totaal van je inschrijving is nu ${euro(i.totaal_bedrag)}.

Sportieve groet,
VVZ'49`;
  return { html, text };
}

const { rows: verzoeken } = await db.query(
  `select b.*, row_to_json(i) as insc from betaalverzoeken b
     join inschrijvingen i on i.id = b.inschrijving_id
    where b.verstuurd_op is null order by b.aangemaakt_op limit 50`);
console.log(`${verzoeken.length} nieuw(e) betaalverzoek(en)`);

for (const v of verzoeken) {
  const i = v.insc;
  const { html, text } = verzoekMail(i, v);
  try {
    await transport.sendMail({
      from: `"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
      to: i.email,
      replyTo: MAIL_REPLY_TO || GMAIL_USER,
      subject: `Aanvullend betaalverzoek ${WEDSTRIJD} (${i.referentie})`,
      html, text,
    });
    await db.query(`update betaalverzoeken set verstuurd_op = now() where id = $1`, [v.id]);
    console.log(`Betaalverzoek verstuurd: ${i.referentie} ${v.bedrag}`);
  } catch (err) {
    fouten++;
    console.error(`Betaalverzoek mislukt: ${i.referentie}: ${err.message}`);
  }
}

// ---------- meldingen bij verwijderen ----------
function meldingMail(m) {
  const terug = Number(m.terug) > 0
    ? (m.soort === 'persoon_verwijderd'
        ? `Je hebt ${euro(m.terug)} te veel betaald. Dit bedrag wordt in overleg teruggestort.`
        : `Je hebt al ${euro(m.terug)} betaald. Dit bedrag wordt in overleg teruggestort.`)
    : '';
  const isInsc = m.soort === 'inschrijving_verwijderd';
  const kop = isInsc ? 'Inschrijving verwijderd' : 'Inschrijving aangepast';
  const regels = isInsc
    ? [`Je inschrijving ${m.referentie} voor ${WEDSTRIJD} (${DATUM}) is verwijderd.`]
    : [`Je inschrijving ${m.referentie} voor ${WEDSTRIJD} (${DATUM}) is aangepast.`,
       m.toelichting, `Het nieuwe totaal van je inschrijving is ${euro(m.nieuw_totaal)}.`];
  if (terug) regels.push(terug);
  regels.push('Heb je vragen? Beantwoord dan deze mail.');
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#1f2a1f">
  <h2 style="color:#1B5E20">${kop}</h2>
  <p>Beste ${esc(m.voornaam)},</p>
  ${regels.map(r => `<p>${esc(r)}</p>`).join('')}
  <p>Sportieve groet,<br>VVZ'49</p>
</div>`;
  const text = `Beste ${m.voornaam},\n\n${regels.join('\n\n')}\n\nSportieve groet,\nVVZ'49`;
  return { kop, html, text };
}

const { rows: meldingen } = await db.query(
  `select * from meldingen where verstuurd_op is null order by aangemaakt_op limit 50`);
console.log(`${meldingen.length} nieuwe melding(en)`);
for (const m of meldingen) {
  const { kop, html, text } = meldingMail(m);
  try {
    await transport.sendMail({
      from: `"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
      to: m.email,
      replyTo: MAIL_REPLY_TO || GMAIL_USER,
      subject: `${kop}: ${WEDSTRIJD} (${m.referentie})`,
      html, text,
    });
    await db.query(`update meldingen set verstuurd_op = now() where id = $1`, [m.id]);
    console.log(`Melding verstuurd: ${m.soort} ${m.referentie}`);
  } catch (err) {
    fouten++;
    console.error(`Melding mislukt: ${m.referentie}: ${err.message}`);
  }
}

await db.end();
if (fouten) process.exit(1);
