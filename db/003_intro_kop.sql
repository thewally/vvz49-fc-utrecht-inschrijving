-- VVZ'49 inschrijving: instelbare koptekst boven de ingeklapte toelichting
-- (thewally/ontwikkelstraat#7). Draai dit NA db/001_schema.sql en db/002_betaling_mail.sql.
-- Idempotent: kan veilig opnieuw gedraaid worden. Draai je 001_schema.sql later opnieuw,
-- draai dan ook dit bestand opnieuw (001 zet formulier_status en de rechten terug).

-- Formulier-status: nu ook de eigen koptekst (leeg = standaardkop in de site)
create or replace function public.formulier_status()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sluitdatum', (select waarde::timestamptz from beheer_instellingen where sleutel = 'sluitdatum'),
    'open', not exists (select 1 from beheer_instellingen
                        where sleutel = 'sluitdatum' and waarde::timestamptz < now()),
    'intro', (select waarde from beheer_instellingen where sleutel = 'intro_html'),
    'intro_kop', (select waarde from beheer_instellingen where sleutel = 'intro_kop'))
$$;

-- Koptekst (platte tekst, mag {sluitdatum} bevatten); leeg = standaardkop
create or replace function public.beheer_zet_intro_kop(wachtwoord text, kop text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;
  if length(coalesce(kop, '')) > 200 then
    return jsonb_build_object('ok', false, 'fout', 'De koptekst is te lang (maximaal 200 tekens).');
  end if;
  if coalesce(trim(kop), '') = '' then
    delete from beheer_instellingen where sleutel = 'intro_kop';
  else
    insert into beheer_instellingen (sleutel, waarde) values ('intro_kop', trim(kop))
    on conflict (sleutel) do update set waarde = excluded.waarde;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Rechten: net als in 001 alleen de Data API-rollen, en alleen voor deze functies
revoke execute on function public.beheer_zet_intro_kop(text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anonymous') then
    grant execute on function public.formulier_status(), public.beheer_zet_intro_kop(text, text) to anonymous;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.formulier_status(), public.beheer_zet_intro_kop(text, text) to authenticated;
  end if;
end $$;

-- Data API de nieuwe functie laten inlezen
notify pgrst, 'reload schema';
