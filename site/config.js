// Publieke configuratie. Hier staan GEEN geheimen: de database is afgeschermd met rechten/RLS.
window.VVZ_CONFIG = {
  // Neon Console > project > Data API > "API URL" (eindigt meestal op /rest/v1)
  DATA_API_URL: 'https://VUL-HIER-JE-NEON-DATA-API-URL-IN/neondb/rest/v1',

  WEDSTRIJD: 'FC Utrecht - Fortuna Sittard',
  DATUM_TEKST: 'Zaterdag 12 december 2026, 16:15 uur',

  PRIJS_16PLUS: 19.5,
  PRIJS_TM15: 12.5,
  PEILDATUM: '2026-12-12',

  // Betaallink. {bedrag} = 44.50, {omschrijving} = URL-encoded tekst
  BUNQ_URL: 'https://bunq.me/AvanderWal?amount={bedrag}&description={omschrijving}',
  OMSCHRIJVING: 'FC Utrecht vs Fortuna Sittard - {contactpersoon} {referentie}',
};
