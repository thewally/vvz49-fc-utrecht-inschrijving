// Verstuurt alle uitgaande mails (draait in GitHub Actions):
// - bevestiging van nieuwe inschrijvingen
// - mails bij wijzigingen door beheer (betaalverzoek, deelnemer/inschrijving verwijderd)
// Teksten komen uit de database (bewerkt in beheer) of anders uit de standaard in site/mail-sjabloon.js.
import pg from 'pg';
import nodemailer from 'nodemailer';
import '../site/mail-sjabloon.js';

const M = globalThis.vvzMail;
const {
  NEON_DATABASE_URL, GMAIL_USER, GMAIL_APP_PASSWORD,
  MAIL_FROM_NAME = "VVZ'49", MAIL_REPLY_TO,
} = process.env;

const BUNQ = 'https://bunq.me/AvanderWal?amount={bedrag}&description={omschrijving}';
const WEDSTRIJD = 'FC Utrecht - Fortuna Sittard';
const DATUM = 'zaterdag 12 december 2026, 16:30 uur';

const euro = (n) => '€ ' + Number(n).toFixed(2).replace('.', ',');
const naam = (i) => [i.voornaam, i.tussenvoegsel, i.achternaam].filter(Boolean).join(' ');

function betaallink(contactnaam, referentie, bedrag, extra = '') {
  const omschrijving = `FC Utrecht vs Fortuna Sittard - ${contactnaam} ${referentie}${extra}`;
  return BUNQ.replace('{bedrag}', Number(bedrag).toFixed(2))
    .replace('{omschrijving}', encodeURIComponent(omschrijving).replace(/%20/g, '+'));
}

const db = new pg.Client({ connectionString: NEON_DATABASE_URL });
await db.connect();

const transport = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

// Eigen sjablonen uit de database
const sjablonen = {};
for (const r of (await db.query(`select sleutel, waarde from beheer_instellingen where sleutel like 'mail_%'`)).rows) {
  try { sjablonen[r.sleutel.slice(5)] = JSON.parse(r.waarde); } catch { /* ongeldig: standaard gebruiken */ }
}

let fouten = 0;
async function verstuur(aan, mail, label) {
  await transport.sendMail({
    from: `"${MAIL_FROM_NAME}" <${GMAIL_USER}>`,
    to: aan,
    replyTo: MAIL_REPLY_TO || GMAIL_USER,
    subject: mail.onderwerp,
    html: mail.html,
    text: mail.text,
  });
  console.log(`Verstuurd: ${label}`);
}

// ---------- bevestigingen ----------
const { rows } = await db.query(
  `select * from inschrijvingen where bevestiging_verstuurd_op is null order by aangemaakt_op limit 50`);
console.log(`${rows.length} nieuwe inschrijving(en)`);

for (const i of rows) {
  const { rows: deelnemers } = await db.query(
    `select * from deelnemers where inschrijving_id = $1 order by achternaam, voornaam`, [i.id]);
  const jong = deelnemers.filter(d => d.categorie === 't/m 15').length;
  const oud = deelnemers.length - jong;
  const spec = [];
  if (jong) spec.push([`${jong}× t/m 15 jaar à ${euro(12.5)}`, euro(jong * 12.5)]);
  if (oud) spec.push([`${oud}× vanaf 16 jaar à ${euro(19.5)}`, euro(oud * 19.5)]);

  const vars = {
    voornaam: i.voornaam, contactpersoon: naam(i), referentie: i.referentie,
    wedstrijd: WEDSTRIJD, datum: DATUM, totaal: euro(i.totaal_bedrag),
    deelnemers: M.tabel(deelnemers.map(d => [`${d.voornaam} ${d.achternaam}`, d.team])),
    specificatie: M.tabel(spec, ['Totaal', euro(i.totaal_bedrag)]),
    betaalknop: M.betaalknop(betaallink(naam(i), i.referentie, i.totaal_bedrag), euro(i.totaal_bedrag)),
  };
  try {
    await verstuur(i.email, M.maak('bevestiging', sjablonen.bevestiging, vars, {}), `bevestiging ${i.referentie}`);
    await db.query(`update inschrijvingen set bevestiging_verstuurd_op = now() where id = $1`, [i.id]);
  } catch (err) {
    fouten++;
    console.error(`Mislukt: ${i.referentie}: ${err.message}`);
  }
}

// ---------- mails bij wijzigingen door beheer ----------
const { rows: wijzigingen } = await db.query(
  `select w.*, i.totaal_bedrag as huidig_totaal from wijzigingen w
     left join inschrijvingen i on i.id = w.inschrijving_id
    where w.mail_verstuurd_op is null order by w.aangemaakt_op limit 50`);
console.log(`${wijzigingen.length} wijziging(en) te mailen`);

for (const w of wijzigingen) {
  // Betaalverzoek dat inmiddels vervallen is: niet meer versturen
  if (w.soort === 'persoon_toegevoegd' && w.vervallen) {
    await db.query(`update wijzigingen set mail_verstuurd_op = now() where id = $1`, [w.id]);
    continue;
  }
  const vars = {
    voornaam: w.voornaam, contactpersoon: w.contact_naam, referentie: w.referentie,
    wedstrijd: WEDSTRIJD, datum: DATUM, toelichting: w.toelichting,
    bedrag: euro(w.bedrag), terug: euro(w.bedrag),
    totaal: euro(w.soort === 'persoon_verwijderd' ? w.nieuw_totaal : (w.huidig_totaal ?? 0)),
    nog_te_betalen: euro(w.nog_te_betalen || 0),
  };
  const aan = {
    terug: w.taak === 'terugstorten' && Number(w.bedrag) > 0,
    nog_te_betalen: Number(w.nog_te_betalen) > 0,
  };
  if (w.soort === 'persoon_toegevoegd') {
    vars.betaalknop = M.betaalknop(betaallink(w.contact_naam, w.referentie, w.bedrag, ' aanvulling'), euro(w.bedrag));
  } else if (aan.nog_te_betalen) {
    vars.betaalknop = M.betaalknop(betaallink(w.contact_naam, w.referentie, w.nog_te_betalen), euro(w.nog_te_betalen));
  } else {
    vars.betaalknop = { html: '' };
  }
  try {
    await verstuur(w.email, M.maak(w.soort, sjablonen[w.soort], vars, aan), `${w.soort} ${w.referentie}`);
    await db.query(`update wijzigingen set mail_verstuurd_op = now() where id = $1`, [w.id]);
  } catch (err) {
    fouten++;
    console.error(`Mislukt: ${w.referentie}: ${err.message}`);
  }
}

await db.end();
if (fouten) process.exit(1);
