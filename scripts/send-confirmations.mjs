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
  <h3 style="color:#1B5E20">Ingeschreven deelnemers</h3>
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

Ingeschreven deelnemers:
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

// ---------- mails bij wijzigingen door beheer ----------
function wijzigingMail(w, insc) {
  const regels = [];
  let knop = null;
  let kop;
  if (w.soort === 'persoon_toegevoegd') {
    kop = 'Aanvullend betaalverzoek';
    regels.push(`Je inschrijving ${w.referentie} voor ${WEDSTRIJD} (${DATUM}) is aangepast.`, w.toelichting,
                `Het nog te betalen bedrag hiervoor is ${euro(w.bedrag)}.`);
    knop = { bedrag: w.bedrag, extra: ' aanvulling' };
    if (insc) regels.push(`Het totaal van je inschrijving is nu ${euro(insc.totaal_bedrag)}.`);
  } else if (w.soort === 'persoon_verwijderd') {
    kop = 'Inschrijving aangepast';
    regels.push(`Je inschrijving ${w.referentie} voor ${WEDSTRIJD} (${DATUM}) is aangepast.`, w.toelichting,
                `Het nieuwe totaal van je inschrijving is ${euro(w.nieuw_totaal)}.`);
    if (Number(w.bedrag) > 0) regels.push(`Je hebt ${euro(w.bedrag)} te veel betaald. Dit bedrag wordt in overleg teruggestort.`);
    if (Number(w.nog_te_betalen) > 0) {
      regels.push(`Je hebt je inschrijving nog niet betaald. Het te betalen bedrag is nu ${euro(w.nog_te_betalen)}.`);
      knop = { bedrag: w.nog_te_betalen, extra: '' };
    }
  } else {
    kop = 'Inschrijving verwijderd';
    regels.push(`Je inschrijving ${w.referentie} voor ${WEDSTRIJD} (${DATUM}) is verwijderd.`);
    if (Number(w.bedrag) > 0) regels.push(`Je hebt al ${euro(w.bedrag)} betaald. Dit bedrag wordt in overleg teruggestort.`);
  }
  regels.push('Heb je vragen? Beantwoord dan deze mail.');

  const link = knop && betaallink({ voornaam: w.contact_naam, referentie: w.referentie }, knop.bedrag, knop.extra);
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;color:#1f2a1f">
  <h2 style="color:#1B5E20">${kop}</h2>
  <p>Beste ${esc(w.voornaam)},</p>
  ${regels.map(r => `<p>${esc(r)}</p>`).join('')}
  ${link ? `<p><a href="${link}" style="background:#2E7D32;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Betaal ${euro(knop.bedrag)} via bunq</a></p>` : ''}
  <p>Sportieve groet,<br>VVZ'49</p>
</div>`;
  const text = `Beste ${w.voornaam},\n\n${regels.join('\n\n')}${link ? `\n\nBetalen: ${link}` : ''}\n\nSportieve groet,\nVVZ'49`;
  return { kop, html, text };
}

const { rows: wijzigingen } = await db.query(
  `select w.*, row_to_json(i) as insc from wijzigingen w
     left join inschrijvingen i on i.id = w.inschrijving_id
    where w.mail_verstuurd_op is null order by w.aangemaakt_op limit 50`);
console.log(`${wijzigingen.length} wijziging(en) te mailen`);

for (const w of wijzigingen) {
  // Betaalverzoek dat inmiddels vervallen is: niet meer versturen
  if (w.soort === 'persoon_toegevoegd' && w.vervallen) {
    await db.query(`update wijzigingen set mail_verstuurd_op = now() where id = $1`, [w.id]);
    continue;
  }
  const { kop, html, text } = wijzigingMail(w, w.insc);
  try {
    await transport.sendMail({
      from: `"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
      to: w.email,
      replyTo: MAIL_REPLY_TO || GMAIL_USER,
      subject: `${kop}: ${WEDSTRIJD} (${w.referentie})`,
      html, text,
    });
    await db.query(`update wijzigingen set mail_verstuurd_op = now() where id = $1`, [w.id]);
    console.log(`Mail verstuurd: ${w.soort} ${w.referentie}`);
  } catch (err) {
    fouten++;
    console.error(`Mail mislukt: ${w.referentie}: ${err.message}`);
  }
}

await db.end();
if (fouten) process.exit(1);
