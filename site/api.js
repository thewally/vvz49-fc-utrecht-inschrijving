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
