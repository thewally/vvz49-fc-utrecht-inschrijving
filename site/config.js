// Publieke configuratie. Hier staan GEEN geheimen: de database is afgeschermd met rechten/RLS.
window.VVZ_CONFIG = {
  // Wordt bij de deploy ingevuld vanuit de GitHub Secret NEON_DATA_API_URL
  DATA_API_URL: '__NEON_DATA_API_URL__',
  // Neon Auth URL (voor het anonieme token), uit de GitHub Secret NEON_AUTH_URL
  NEON_AUTH_URL: '__NEON_AUTH_URL__',

  WEDSTRIJD: 'FC Utrecht - Fortuna Sittard',
  DATUM_TEKST: 'Zaterdag 12 december 2026, 16:15 uur',

  PRIJS_16PLUS: 19.5,
  PRIJS_TM15: 12.5,
  PEILDATUM: '2026-12-12',

  // Betaallink. {bedrag} = 44.50, {omschrijving} = URL-encoded tekst
  BUNQ_URL: 'https://bunq.me/AvanderWal?amount={bedrag}&description={omschrijving}',
  OMSCHRIJVING: 'FC Utrecht vs Fortuna Sittard - {contactpersoon} {referentie}',
};
