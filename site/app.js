(() => {
  const C = window.VVZ_CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Fallback als de teamlijst niet uit de database geladen kan worden
  let TEAMS = ["VVZ'49 1", "VVZ'49 2", "VVZ'49 3", "VVZ'49 4", "VVZ'49 35+", "VVZ'49 45+ 7x7",
    'O23-1', 'O19-1', 'O19-2', 'O17-1', 'O16-1', 'O14-1', 'O14-2', 'O14-6', 'O13-1', 'O13-2',
    'O12-1', 'O12-2', 'O11-1', 'O11-2', 'O9-1', 'O9-2', 'O8-1', 'O8-2'];

  const euro = (n) => '€ ' + n.toFixed(2).replace('.', ',');

  $('#titel').textContent = C.WEDSTRIJD;
  $('#datum').textContent = C.DATUM_TEKST;
  fetch('intro.html').then(r => r.ok ? r.text() : '').then(h => { $('#intro').innerHTML = h; });

  const rpc = (naam, body) => window.vvzRpc(naam, body);

  rpc('teams').then(t => { if (Array.isArray(t) && t.length) { TEAMS = t; vulTeams(); } }).catch(() => {});

  // ---------- leeftijd & prijs ----------
  function leeftijdOpPeildatum(geb) {
    const p = new Date(C.PEILDATUM + 'T00:00:00'), g = new Date(geb + 'T00:00:00');
    let l = p.getFullYear() - g.getFullYear();
    if (p.getMonth() < g.getMonth() || (p.getMonth() === g.getMonth() && p.getDate() < g.getDate())) l--;
    return l;
  }
  const categorie = (geb) => leeftijdOpPeildatum(geb) >= 16 ? '16+' : 't/m 15';

  // ---------- personen ----------
  function vulTeams() {
    $$('.p-team').forEach(sel => {
      const huidig = sel.value;
      sel.innerHTML = '<option value="">Kies een team</option>' +
        TEAMS.map(t => `<option>${t.replace(/</g, '&lt;')}</option>`).join('');
      sel.value = huidig;
    });
  }

  function nummer() {
    const blokken = $$('#personen .persoon');
    blokken.forEach((b, i) => {
      $('.persoon-nr', b).textContent = `Persoon ${i + 1}`;
      $('.verwijder', b).classList.toggle('verborgen', blokken.length === 1);
    });
  }

  function persoonToevoegen() {
    const el = $('#persoon-template').content.firstElementChild.cloneNode(true);
    $('#personen').appendChild(el);
    vulTeams();
    $('.verwijder', el).addEventListener('click', () => { el.remove(); nummer(); });
    $('.p-geboortedatum', el).addEventListener('change', (e) => {
      const v = e.target.value;
      $('.categorie', el).textContent = v ? `Tarief: ${categorie(v) === '16+' ? 'vanaf 16 jaar' : 't/m 15 jaar'}` : '';
    });
    // Achternaam contactpersoon alvast invullen
    const an = [$('#c-tussenvoegsel').value.trim(), $('#c-achternaam').value.trim()].filter(Boolean).join(' ');
    if (an) $('.p-achternaam', el).value = an;
    nummer();
  }
  $('#persoon-toevoegen').addEventListener('click', persoonToevoegen);

  // ---------- validatie ----------
  function controleer(sectie) {
    let ok = true;
    $$('input[required], select[required]', sectie).forEach(i => {
      let geldig = i.value.trim() !== '';
      if (geldig && i.type === 'email') geldig = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.value.trim());
      if (geldig && i.type === 'date') geldig = i.value <= C.PEILDATUM && i.value >= '1900-01-01';
      i.classList.toggle('ongeldig', !geldig);
      if (!geldig) ok = false;
    });
    if (!ok) $('.ongeldig', sectie)?.focus();
    return ok;
  }

  // ---------- gegevens verzamelen ----------
  const contact = () => ({
    voornaam: $('#c-voornaam').value.trim(),
    tussenvoegsel: $('#c-tussenvoegsel').value.trim(),
    achternaam: $('#c-achternaam').value.trim(),
    email: $('#c-email').value.trim(),
    telefoon: $('#c-telefoon').value.trim(),
  });
  const personen = () => $$('#personen .persoon').map(b => ({
    voornaam: $('.p-voornaam', b).value.trim(),
    achternaam: $('.p-achternaam', b).value.trim(),
    geboortedatum: $('.p-geboortedatum', b).value,
    team: $('.p-team', b).value,
  }));
  const naamContact = (c) => [c.voornaam, c.tussenvoegsel, c.achternaam].filter(Boolean).join(' ');

  function berekening() {
    const ps = personen();
    const jong = ps.filter(p => categorie(p.geboortedatum) === 't/m 15').length;
    const oud = ps.length - jong;
    return { jong, oud, totaal: jong * C.PRIJS_TM15 + oud * C.PRIJS_16PLUS };
  }

  function toonOverzicht() {
    const { jong, oud, totaal } = berekening();
    const c = contact();
    const rijen = [];
    if (jong) rijen.push(`<tr><td>${jong}× t/m 15 jaar à ${euro(C.PRIJS_TM15)}</td><td class="bedrag">${euro(jong * C.PRIJS_TM15)}</td></tr>`);
    if (oud) rijen.push(`<tr><td>${oud}× vanaf 16 jaar à ${euro(C.PRIJS_16PLUS)}</td><td class="bedrag">${euro(oud * C.PRIJS_16PLUS)}</td></tr>`);
    rijen.push(`<tr class="totaal"><td>Totaal</td><td class="bedrag">${euro(totaal)}</td></tr>`);
    $('#spec').innerHTML = rijen.join('');
    const esc = (s) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    $('#samenvatting').innerHTML =
      `Contactpersoon: <strong>${esc(naamContact(c))}</strong> (${esc(c.email)})<br>` +
      personen().map(p => `${esc(p.voornaam)} ${esc(p.achternaam)} – ${esc(p.team)}`).join('<br>') +
      `<br><br>De leeftijd telt op de wedstrijddag (12 december 2026).`;
  }

  // ---------- stappen ----------
  let stap = 1;
  function gaNaar(n) {
    const huidige = $(`section[data-stap="${stap}"]`);
    if (n > stap && !controleer(huidige)) return;
    if (n === 2 && !$('#personen .persoon')) persoonToevoegen();
    if (n === 3) toonOverzicht();
    stap = n;
    $$('section[data-stap]').forEach(s => s.classList.toggle('verborgen', +s.dataset.stap !== n));
    $$('#stappen li').forEach(li => {
      li.classList.toggle('actief', +li.dataset.stap === n);
      li.classList.toggle('klaar', +li.dataset.stap < n);
    });
    $('#melding').innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('[data-naar]').forEach(b => b.addEventListener('click', () => gaNaar(+b.dataset.naar)));

  // ---------- versturen ----------
  $('#formulier').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#website').value) return; // honeypot
    const knop = $('#betaal-knop');
    knop.disabled = true; knop.textContent = 'Bezig met opslaan...';
    try {
      const c = contact();
      const res = await rpc('registreer', { contact: c, personen: personen() });
      const omschrijving = C.OMSCHRIJVING
        .replace('{contactpersoon}', naamContact(c))
        .replace('{referentie}', res.referentie);
      const url = C.BUNQ_URL
        .replace('{bedrag}', Number(res.totaal).toFixed(2))
        .replace('{omschrijving}', encodeURIComponent(omschrijving).replace(/%20/g, '+'));
      $('#melding').innerHTML = `<div class="melding ok">Inschrijving opgeslagen (${res.referentie}). Je wordt doorgestuurd naar bunq…</div>`;
      window.location.href = url;
    } catch (err) {
      $('#melding').innerHTML = `<div class="melding fout">Er ging iets mis: ${err.message}</div>`;
      knop.disabled = false; knop.textContent = 'Inschrijven en betalen';
    }
  });

  gaNaar(1);
})();
