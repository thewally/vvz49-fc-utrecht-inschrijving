// Verstuurt alle uitgaande mails (draait in GitHub Actions):
// - bevestiging van nieuwe inschrijvingen
// - mails bij wijzigingen door beheer (betaalverzoek, deelnemer/inschrijving verwijderd)
// Teksten komen uit de database (bewerkt in beheer) of anders uit de standaard in site/mail-sjabloon.js.
import pg from 'pg';
import nodemailer from 'nodemailer';
import '../site/mail-sjabloon.js';
import { berekenSaldo } from './saldo.mjs';

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
  `select w.*, i.totaal_bedrag as huidig_totaal, i.betaald as insc_betaald, i.inschrijf_bedrag
     from wijzigingen w
     left join inschrijvingen i on i.id = w.inschrijving_id
    where w.mail_verstuurd_op is null order by w.aangemaakt_op limit 50`);
console.log(`${wijzigingen.length} wijziging(en) te mailen`);

for (const w of wijzigingen) {
  // Niet meer versturen: vervallen betaalverzoek, of een aanpassing van een inmiddels verwijderde inschrijving
  // (dan volgt de mail "Inschrijving verwijderd" met het totale terug te storten bedrag)
  if ((w.soort === 'persoon_toegevoegd' && w.vervallen) ||
      (w.soort !== 'inschrijving_verwijderd' && !w.inschrijving_id)) {
    await db.query(`update wijzigingen set mail_verstuurd_op = now() where id = $1`, [w.id]);
    continue;
  }

  // Huidige deelnemers en het bedrag dat nu nog verschuldigd is: nieuw totaal min wat al betaald is
  let deelnemers = [];
  let saldo = berekenSaldo({ totaal: 0 });
  if (w.inschrijving_id) {
    deelnemers = (await db.query(
      `select voornaam, achternaam, team from deelnemers where inschrijving_id = $1 order by achternaam, voornaam`,
      [w.inschrijving_id])).rows;
    const { rows: [bet] } = await db.query(
      `select coalesce(sum(bedrag) filter (where taak = 'betalen'), 0) as betaald,
              coalesce(sum(bedrag) filter (where taak = 'terugstorten'), 0) as teruggestort
         from wijzigingen
        where inschrijving_id = $1 and afgehandeld and not vervallen`, [w.inschrijving_id]);
    saldo = berekenSaldo({
      totaal: w.huidig_totaal,
      inschrijfBetaald: w.insc_betaald,
      inschrijfBedrag: w.inschrijf_bedrag,
      betaald: bet.betaald,
      teruggestort: bet.teruggestort,
    });
  }
  const { openstaand } = saldo;

  // Bij verwijderen van de hele inschrijving: alles wat nog teruggestort moet worden.
  // Bij een wijziging van deelnemers: het bedrag dat na de wijziging terugkomt (alleen als er te veel betaald is).
  let bedrag = Number(w.bedrag);
  let terug;
  if (w.soort === 'inschrijving_verwijderd') {
    bedrag = Number((await db.query(
      `select coalesce(sum(bedrag), 0) as s from wijzigingen
        where referentie = $1 and taak = 'terugstorten' and not afgehandeld and not vervallen`, [w.referentie])).rows[0].s);
    terug = bedrag;
  } else {
    terug = saldo.terug;
    if (terug > 0) bedrag = terug;
  }

  const verschilRij = saldo.verschil < 0
    ? ['Terug te ontvangen', euro(saldo.terug)]
    : ['Nog te betalen', euro(saldo.openstaand)];
  const vars = {
    voornaam: w.voornaam, contactpersoon: w.contact_naam, referentie: w.referentie,
    wedstrijd: WEDSTRIJD, datum: DATUM, toelichting: w.toelichting,
    bedrag: euro(bedrag), terug: euro(terug), ontvangen: euro(w.bedrag),
    totaal: euro(w.soort === 'persoon_verwijderd' ? w.nieuw_totaal : (w.huidig_totaal ?? 0)),
    openstaand: euro(openstaand),
    nog_te_betalen: euro(openstaand),
    deelnemers: M.tabel(deelnemers.map(d => [`${d.voornaam} ${d.achternaam}`, d.team])),
    specificatie: w.inschrijving_id
      ? M.tabel([['Nieuw totaal van de inschrijving', euro(saldo.totaal)], ['Al betaald', euro(saldo.ontvangen)]], verschilRij)
      : { html: '' },
    betaalknop: openstaand > 0
      ? M.betaalknop(betaallink(w.contact_naam, w.referentie, openstaand), euro(openstaand))
      : { html: '' },
  };
  const aan = {
    terug: terug > 0,
    openstaand: openstaand > 0,
    nog_te_betalen: openstaand > 0,
  };
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
