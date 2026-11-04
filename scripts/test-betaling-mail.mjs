// Test van de mailsoort "betaling_ontvangen" (sjabloon). Draaien: node scripts/test-betaling-mail.mjs
import '../site/mail-sjabloon.js';

const M = globalThis.vvzMail;
let fouten = 0;
const check = (naam, ok) => { console.log(`${ok ? 'ok  ' : 'FOUT'} ${naam}`); if (!ok) fouten++; };

const S = M.SOORTEN.betaling_ontvangen;
check('soort bestaat met naam', !!S && S.naam === 'Betaling ontvangen');
check('alle variabelen hebben uitleg', S.variabelen.every(v => M.UITLEG[v]));
check('voorwaarden hebben uitleg', S.voorwaarden.every(v => M.UITLEG[v]));

const basis = {
  voornaam: 'Anna', contactpersoon: 'Anna Test', referentie: 'VVZ-12345',
  wedstrijd: 'FC Utrecht - Fortuna Sittard', datum: 'zaterdag 12 december 2026, 16:30 uur',
  ontvangen: '€ 19,50', totaal: '€ 32,00',
  deelnemers: M.tabel([['Vol Wassen', 'Overig'], ['Kind Klein', 'Overig']]),
  specificatie: M.tabel([['Nieuw totaal van de inschrijving', '€ 32,00'], ['Al betaald', '€ 19,50']], ['Nog te betalen', '€ 12,50']),
  openstaand: '€ 12,50', terug: '€ 0,00',
  betaalknop: M.betaalknop('https://bunq.me/x', '€ 12,50'),
};

// Alles betaald
let m = M.maak('betaling_ontvangen', null, { ...basis, openstaand: '€ 0,00' }, { openstaand: false, terug: false });
check('onderwerp bevat referentie', m.onderwerp === 'Betaling ontvangen FC Utrecht - Fortuna Sittard (VVZ-12345)');
check('toont ontvangen bedrag', m.text.includes('€ 19,50'));
check('toont wedstrijd en datum', m.text.includes('FC Utrecht - Fortuna Sittard') && m.text.includes('zaterdag 12 december 2026, 16:30 uur'));
check('toont deelnemers', m.text.includes('Vol Wassen') && m.text.includes('Kind Klein'));
check('geen "nog open" en geen betaalknop', !m.text.includes('staat nog') && !m.html.includes('bunq.me'));
check('geen niet-ingevulde variabelen', !/\{\w+\}/.test(m.html + m.onderwerp));

// Nog een bedrag open
m = M.maak('betaling_ontvangen', null, basis, { openstaand: true, terug: false });
check('toont openstaand bedrag', m.text.includes('Er staat nog € 12,50 open'));
check('toont betaalknop', m.html.includes('https://bunq.me/x'));

// Te veel betaald
m = M.maak('betaling_ontvangen', null, { ...basis, terug: '€ 5,00', openstaand: '€ 0,00' }, { openstaand: false, terug: true });
check('toont te veel betaald', m.text.includes('€ 5,00 te veel betaald'));

// Eigen tekst uit beheer overschrijft de standaard
m = M.maak('betaling_ontvangen', { onderwerp: 'Betaald {referentie}', html: '<p>Hoi {voornaam}, {ontvangen} binnen.</p>' }, basis, {});
check('eigen tekst wordt gebruikt', m.text.includes('Hoi Anna, € 19,50 binnen.'));

// Bestaande soorten ongewijzigd aanwezig
check('bestaande soorten aanwezig', ['bevestiging', 'persoon_toegevoegd', 'persoon_verwijderd', 'inschrijving_verwijderd'].every(k => M.SOORTEN[k]));

process.exit(fouten ? 1 : 0);
