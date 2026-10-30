// Mailsjablonen: gedeeld door de beheerpagina (bewerken/voorbeeld) en het mailscript (versturen).
// Variabelen: {naam}. Voorwaardelijke stukken: {#naam}...{/naam} (alleen zichtbaar als dat van toepassing is).
globalThis.vvzMail = (() => {
  const groet = '<p>Heb je vragen? Beantwoord dan deze mail.</p><p>Sportieve groet,<br>VVZ\'49 - Jeugd Activiteiten Commissie</p>';

  const SOORTEN = {
    bevestiging: {
      naam: 'Bevestiging inschrijving',
      onderwerp: 'Bevestiging inschrijving {wedstrijd} ({referentie})',
      html: '<p>Beste {voornaam},</p>' +
        '<p>Bedankt voor je inschrijving voor <strong>{wedstrijd}</strong> op {datum}. Je referentie is <strong>{referentie}</strong>.</p>' +
        '<h3>Ingeschreven deelnemers</h3><p>{deelnemers}</p>' +
        '<h3>Te betalen</h3><p>{specificatie}</p>' +
        '<p>Heb je nog niet betaald? Dat kan via onderstaande knop:</p><p>{betaalknop}</p>' + groet,
      variabelen: ['voornaam', 'contactpersoon', 'referentie', 'wedstrijd', 'datum', 'totaal', 'deelnemers', 'specificatie', 'betaalknop'],
      voorwaarden: [],
    },
    persoon_toegevoegd: {
      naam: 'Aanvullend betaalverzoek (deelnemer toegevoegd)',
      onderwerp: 'Aanvullend betaalverzoek {wedstrijd} ({referentie})',
      html: '<p>Beste {voornaam},</p>' +
        '<p>Je inschrijving {referentie} voor {wedstrijd} ({datum}) is aangepast:</p><p>{toelichting}</p>' +
        '<p>Het nog te betalen bedrag hiervoor is <strong>{bedrag}</strong>.</p><p>{betaalknop}</p>' +
        '<p>Het totaal van je inschrijving is nu {totaal}.</p>' + groet,
      variabelen: ['voornaam', 'contactpersoon', 'referentie', 'wedstrijd', 'datum', 'toelichting', 'bedrag', 'totaal', 'betaalknop'],
      voorwaarden: [],
    },
    persoon_verwijderd: {
      naam: 'Deelnemer verwijderd',
      onderwerp: 'Inschrijving aangepast: {wedstrijd} ({referentie})',
      html: '<p>Beste {voornaam},</p>' +
        '<p>Je inschrijving {referentie} voor {wedstrijd} ({datum}) is aangepast.</p><p>{toelichting}</p>' +
        '<p>Het nieuwe totaal van je inschrijving is {totaal}.</p>' +
        '<p>{#terug}Je hebt {terug} te veel betaald. Dit bedrag wordt in overleg teruggestort.{/terug}</p>' +
        '<p>{#nog_te_betalen}Je hebt je inschrijving nog niet betaald. Het te betalen bedrag is nu {nog_te_betalen}.{/nog_te_betalen}</p>' +
        '<p>{#nog_te_betalen}{betaalknop}{/nog_te_betalen}</p>' + groet,
      variabelen: ['voornaam', 'contactpersoon', 'referentie', 'wedstrijd', 'datum', 'toelichting', 'totaal', 'terug', 'nog_te_betalen', 'betaalknop'],
      voorwaarden: ['terug', 'nog_te_betalen'],
    },
    inschrijving_verwijderd: {
      naam: 'Inschrijving verwijderd',
      onderwerp: 'Inschrijving verwijderd: {wedstrijd} ({referentie})',
      html: '<p>Beste {voornaam},</p>' +
        '<p>Je inschrijving {referentie} voor {wedstrijd} ({datum}) is verwijderd.</p>' +
        '<p>{#terug}Je hebt al {terug} betaald. Dit bedrag wordt in overleg teruggestort.{/terug}</p>' + groet,
      variabelen: ['voornaam', 'contactpersoon', 'referentie', 'wedstrijd', 'datum', 'terug'],
      voorwaarden: ['terug'],
    },
  };

  const UITLEG = {
    voornaam: 'Voornaam contactpersoon', contactpersoon: 'Volledige naam contactpersoon', referentie: 'Referentie (VVZ-12345)',
    wedstrijd: 'Wedstrijd', datum: 'Datum en tijd wedstrijd', totaal: 'Totaalbedrag inschrijving',
    deelnemers: 'Tabel met deelnemers en teams', specificatie: 'Tabel met bedragen', betaalknop: 'Groene bunq-betaalknop',
    toelichting: 'Wat er gewijzigd is', bedrag: 'Bedrag van dit betaalverzoek', terug: 'Terug te storten bedrag',
    nog_te_betalen: 'Nog te betalen bedrag',
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // vars: { naam: { html } | string }, aan: { voorwaarde: true/false }
  function vul(tekst, vars, aan = {}) {
    let t = String(tekst || '').replace(/\{#(\w+)\}([\s\S]*?)\{\/\1\}/g, (_, k, binnen) => (aan[k] ? binnen : ''));
    t = t.replace(/\{(\w+)\}/g, (m, k) => {
      if (!(k in vars)) return m;
      const v = vars[k];
      return v && typeof v === 'object' ? v.html : esc(v);
    });
    return t;
  }

  function opmaak(html) {
    return html
      .replace(/<p>\s*(?:<br\s*\/?>)?\s*<\/p>/g, '')                        // lege alinea's (weggevallen voorwaarden)
      .replace(/<p>\s*(<table[\s\S]*?<\/table>)\s*<\/p>/g, '$1')
      .replace(/<h3>/g, '<h3 style="color:#1B5E20;margin:18px 0 6px">')
      .replace(/<p>/g, '<p style="margin:0 0 12px">');
  }

  function naarTekst(html) {
    return html
      .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '$2: $1')
      .replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|h3|tr|table|ul|ol)>/g, '\n\n').replace(/<li>/g, '- ').replace(/<\/li>/g, '\n')
      .replace(/<\/td>\s*<td[^>]*>/g, '  ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function betaalknop(link, bedragTekst) {
    return { html: `<a href="${esc(link)}" style="display:inline-block;background:#2E7D32;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Betaal ${esc(bedragTekst)} via bunq</a>` };
  }

  function tabel(rijen, totaalRij) {
    const td = 'padding:4px 8px 4px 0;border-bottom:1px solid #ddd';
    return { html: `<table style="border-collapse:collapse;width:100%;max-width:560px">` +
      rijen.map(([a, b]) => `<tr><td style="${td}">${esc(a)}</td><td style="${td};text-align:right">${esc(b)}</td></tr>`).join('') +
      (totaalRij ? `<tr><td style="padding:6px 0;border-top:2px solid #2E7D32"><strong>${esc(totaalRij[0])}</strong></td>` +
        `<td style="padding:6px 0;border-top:2px solid #2E7D32;text-align:right"><strong>${esc(totaalRij[1])}</strong></td></tr>` : '') +
      `</table>` };
  }

  // sjabloon: { onderwerp, html } (eigen tekst) of leeg (standaard)
  function maak(soort, sjabloon, vars, aan) {
    const s = { ...SOORTEN[soort], ...(sjabloon && sjabloon.html ? sjabloon : {}) };
    const html = opmaak(vul(s.html, vars, aan));
    return {
      onderwerp: naarTekst(vul(s.onderwerp, vars, aan)).replace(/\s+/g, ' '),
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1f2a1f;line-height:1.5">${html}</div>`,
      text: naarTekst(html),
    };
  }

  return { SOORTEN, UITLEG, vul, maak, betaalknop, tabel, naarTekst };
})();
