// Draaien: node scripts/test-saldo.mjs
import assert from 'node:assert/strict';
import { berekenSaldo } from './saldo.mjs';

const eq = (naam, invoer, verwacht) => {
  const s = berekenSaldo(invoer);
  assert.equal(s.openstaand, verwacht.openstaand ?? 0, `${naam}: openstaand`);
  assert.equal(s.terug, verwacht.terug ?? 0, `${naam}: terug`);
  console.log(`ok  ${naam}`);
};

// a) 19,50 + 12,50, betaald 32,00; kind verwijderen -> terug 12,50 (terugstorting nog niet afgehandeld)
eq('a', { totaal: 19.5, inschrijfBetaald: true, inschrijfBedrag: 32 }, { terug: 12.5 });
// b) onbetaald 32,00; kind verwijderen -> inschrijfbedrag zakt naar 19,50 -> nog te betalen 19,50
eq('b', { totaal: 19.5, inschrijfBetaald: false, inschrijfBedrag: 19.5 }, { openstaand: 19.5 });
// c) betaald 19,50; volwassene toevoegen -> totaal 39,00 -> nog te betalen 19,50
eq('c', { totaal: 39, inschrijfBetaald: true, inschrijfBedrag: 19.5 }, { openstaand: 19.5 });
// d) betaald 32,00 (19,50 + 12,50); kind verwijderen en volwassene toevoegen -> totaal 39,00 -> nog te betalen 7,00
eq('d', { totaal: 39, inschrijfBetaald: true, inschrijfBedrag: 32 }, { openstaand: 7 });
// e) niets open: totaal gelijk aan betaald
eq('e', { totaal: 32, inschrijfBetaald: true, inschrijfBedrag: 32 }, {});
// f) afgehandeld betaalverzoek telt mee, afgehandelde terugstorting trekt af
eq('f1', { totaal: 39, inschrijfBetaald: true, inschrijfBedrag: 19.5, betaald: 19.5 }, {});
eq('f2', { totaal: 19.5, inschrijfBetaald: true, inschrijfBedrag: 32, teruggestort: 12.5 }, {});
// g) oudere rij zonder inschrijfbedrag, niet betaald
eq('g', { totaal: 12.5, inschrijfBetaald: false, inschrijfBedrag: null }, { openstaand: 12.5 });
// h) afrondingsfouten van floats
eq('h', { totaal: 0.3, inschrijfBetaald: true, inschrijfBedrag: 0.1, betaald: 0.2 }, {});
console.log('Alles geslaagd');
