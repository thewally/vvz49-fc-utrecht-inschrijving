// Gedeelde aanroep van de Neon Data API.
// Neon vereist ook voor anonieme aanroepen een JWT; die halen we op bij Neon Auth (/token/anonymous).
(() => {
  const C = window.VVZ_CONFIG;
  let token = null, verloopt = 0;

  async function haalToken(forceer) {
    if (!forceer && token && Date.now() < verloopt - 60_000) return token;
    const r = await fetch(`${C.NEON_AUTH_URL}/token/anonymous`, { credentials: 'omit' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || !d.token) throw new Error('Kon geen verbinding maken met de inschrijfservice (token).');
    token = d.token;
    const exp = d.expires_at ? (typeof d.expires_at === 'number'
      ? (d.expires_at < 1e12 ? d.expires_at * 1000 : d.expires_at) : Date.parse(d.expires_at)) : 0;
    verloopt = exp || Date.now() + 30 * 60_000;
    return token;
  }

  async function aanroep(naam, body, tok) {
    return fetch(`${C.DATA_API_URL}/rpc/${naam}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${tok}` },
      body: JSON.stringify(body || {}),
    });
  }

  window.vvzRpc = async function (naam, body) {
    let r = await aanroep(naam, body, await haalToken(false));
    if (r.status === 401 || r.status === 400 && (await r.clone().text()).includes('JWT')) {
      r = await aanroep(naam, body, await haalToken(true));
    }
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && (data.message || data.hint)) || `Fout ${r.status}`);
    return data;
  };
})();
