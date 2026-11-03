// Bedrag dat na een wijziging nog verschuldigd is (kaart thewally/ontwikkelstraat#2).
// verschil = huidig totaal van de deelnemers - wat al betaald is.
// Al betaald = inschrijfbedrag (als "betaald" is aangevinkt) + afgehandelde betaalverzoeken
//              - afgehandelde terugstortingen. Vervallen wijzigingen tellen niet mee (filter in de query).
// verschil > 0: nog te betalen; verschil < 0: terug te ontvangen; 0: niets open.
export function berekenSaldo({ totaal, inschrijfBetaald, inschrijfBedrag, betaald, teruggestort }) {
  const ontvangen = (inschrijfBetaald ? Number(inschrijfBedrag ?? 0) : 0) + Number(betaald ?? 0) - Number(teruggestort ?? 0);
  const verschil = Math.round((Number(totaal ?? 0) - ontvangen) * 100) / 100;
  return {
    totaal: Number(totaal ?? 0),
    ontvangen: Math.round(ontvangen * 100) / 100,
    verschil,
    openstaand: verschil > 0 ? verschil : 0,
    terug: verschil < 0 ? -verschil : 0,
  };
}
