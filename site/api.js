// Gedeelde aanroep van de Neon Data API.
// Neon vereist een JWT; het anonieme token wordt bij de deploy in config.js gezet
// en geeft alleen de rechten van de rol "anonymous" (inschrijven, niets lezen).
window.vvzRpc = async function (naam, body) {
  const C = window.VVZ_CONFIG;
  const r = await fetch(`${C.DATA_API_URL}/rpc/${naam}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${C.ANON_TOKEN}`,
    },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error((data && (data.message || data.hint)) || `Fout ${r.status}`);
  return data;
};

// Opschonen van de (in beheer bewerkte) introtekst: alleen eenvoudige opmaak toegestaan.
window.vvzSchoon = function (html) {
  const toegestaan = { P: [], BR: [], STRONG: [], B: [], EM: [], I: [], U: [], UL: [], OL: [], LI: [], A: ['href'], H3: [], DIV: [] };
  const weg = ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE'];
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const schoon = (node) => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === 3) continue;                      // tekst
      if (c.nodeType !== 1) { c.remove(); continue; }      // commentaar e.d.
      if (weg.includes(c.tagName)) { c.remove(); continue; }
      schoon(c);
      if (!toegestaan[c.tagName]) { c.replaceWith(...c.childNodes); continue; }
      for (const a of [...c.attributes]) if (!toegestaan[c.tagName].includes(a.name)) c.removeAttribute(a.name);
      if (c.tagName === 'A') {
        if (!/^(https?:|mailto:)/i.test(c.getAttribute('href') || '')) c.removeAttribute('href');
        c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener');
      }
    }
  };
  const root = doc.body.firstElementChild;
  schoon(root);
  return root.innerHTML.trim();
};
