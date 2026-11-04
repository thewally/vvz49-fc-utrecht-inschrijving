-- VVZ'49 inschrijving: mail "Betaling ontvangen" bij aanvinken van Betaald
-- (thewally/ontwikkelstraat#5). Draai dit NA db/001_schema.sql.
-- Idempotent: kan veilig opnieuw gedraaid worden. Draai je 001_schema.sql later
-- opnieuw, draai dan ook dit bestand opnieuw (001 zet de oude functies terug).

-- Nieuwe mailsoort toestaan
alter table wijzigingen drop constraint if exists wijzigingen_soort_check;
alter table wijzigingen add constraint wijzigingen_soort_check
  check (soort in ('persoon_toegevoegd', 'persoon_verwijderd', 'inschrijving_verwijderd', 'betaling_ontvangen'));

-- Betaald aanvinken bij de inschrijving: vanaf nu ook een mail in de wachtrij
create or replace function public.beheer_zet_betaald(wachtwoord text, inschrijving uuid, is_betaald boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_was    boolean;
  v_bedrag numeric(8,2);
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;

  select betaald, inschrijf_bedrag into v_was, v_bedrag
    from inschrijvingen where id = inschrijving for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update inschrijvingen
     set betaald = is_betaald,
         betaald_op = case when is_betaald then now() else null end
   where id = inschrijving;

  -- Aanvinken (niet uitvinken): de contactpersoon krijgt een mail dat de betaling is ontvangen
  if is_betaald and not v_was and coalesce(v_bedrag, 0) > 0 then
    perform vvz_log(inschrijving, 'betaling_ontvangen',
                    format('Betaling van € %s ontvangen', replace(v_bedrag::text, '.', ',')), v_bedrag, null);
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- Betaalverzoek afvinken: idem
create or replace function public.beheer_zet_taak(wachtwoord text, wijziging uuid, is_afgehandeld boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_w wijzigingen%rowtype;
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;
  select * into v_w from wijzigingen
   where id = wijziging and taak is not null and not vervallen for update;
  if v_w.id is null then
    return jsonb_build_object('ok', false);
  end if;

  update wijzigingen
     set afgehandeld = is_afgehandeld,
         afgehandeld_op = case when is_afgehandeld then now() end
   where id = wijziging;

  -- Betaling van een aanvullend betaalverzoek aangevinkt: mail dat de betaling is ontvangen
  if is_afgehandeld and not v_w.afgehandeld and v_w.taak = 'betalen'
     and v_w.bedrag > 0 and v_w.inschrijving_id is not null then
    perform vvz_log(v_w.inschrijving_id, 'betaling_ontvangen',
                    format('Betaling van € %s ontvangen', replace(v_w.bedrag::text, '.', ',')), v_w.bedrag, null);
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- Mailtekst "Betaling ontvangen" mag worden opgeslagen
create or replace function public.beheer_zet_mailtekst(wachtwoord text, soort text, onderwerp text, html text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;
  if soort not in ('bevestiging', 'persoon_toegevoegd', 'persoon_verwijderd', 'inschrijving_verwijderd', 'betaling_ontvangen') then
    return jsonb_build_object('ok', false, 'fout', 'Onbekende mailsoort.');
  end if;
  if length(coalesce(html, '')) > 20000 or length(coalesce(onderwerp, '')) > 300 then
    return jsonb_build_object('ok', false, 'fout', 'De tekst is te lang.');
  end if;
  if coalesce(trim(html), '') = '' then
    delete from beheer_instellingen where sleutel = 'mail_' || soort;
  else
    insert into beheer_instellingen (sleutel, waarde)
    values ('mail_' || soort, jsonb_build_object('onderwerp', coalesce(onderwerp, ''), 'html', html)::text)
    on conflict (sleutel) do update set waarde = excluded.waarde;
  end if;
  return jsonb_build_object('ok', true);
end $$;
