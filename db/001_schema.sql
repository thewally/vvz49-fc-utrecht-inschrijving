-- VVZ'49 inschrijving FC Utrecht - Fortuna Sittard (12-12-2026)
-- Idempotent: kan veilig opnieuw gedraaid worden.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------
create table if not exists teams (
  naam      text primary key,
  volgorde  int  not null
);

insert into teams (naam, volgorde) values
  ('VVZ''49 1', 1), ('VVZ''49 2', 2), ('VVZ''49 3', 3), ('VVZ''49 4', 4),
  ('VVZ''49 35+', 5), ('VVZ''49 45+ 7x7', 6),
  ('O23-1', 7), ('O19-1', 8), ('O19-2', 9), ('O17-1', 10), ('O16-1', 11),
  ('O14-1', 12), ('O14-2', 13), ('O14-6', 14), ('O13-1', 15), ('O13-2', 16),
  ('O12-1', 17), ('O12-2', 18), ('O11-1', 19), ('O11-2', 20),
  ('O9-1', 21), ('O9-2', 22), ('O8-1', 23), ('O8-2', 24),
  ('Overig', 99)
on conflict (naam) do update set volgorde = excluded.volgorde;

create table if not exists inschrijvingen (
  id                        uuid primary key default gen_random_uuid(),
  referentie                text not null unique,
  aangemaakt_op             timestamptz not null default now(),
  voornaam                  text not null,
  tussenvoegsel             text,
  achternaam                text not null,
  email                     text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefoon                  text not null,
  totaal_bedrag             numeric(8,2) not null default 0,
  betaald                   boolean not null default false,
  betaald_op                timestamptz,
  bevestiging_verstuurd_op  timestamptz
);

create table if not exists deelnemers (
  id               uuid primary key default gen_random_uuid(),
  inschrijving_id  uuid not null references inschrijvingen(id) on delete cascade,
  voornaam         text not null,
  achternaam       text not null,
  geboortedatum    date not null,
  team             text not null references teams(naam),
  categorie        text not null check (categorie in ('t/m 15', '16+')),
  prijs            numeric(6,2) not null
);
create index if not exists deelnemers_inschrijving_idx on deelnemers (inschrijving_id);

-- Bedrag van de oorspronkelijke inschrijving (waar het vinkje "Betaald" bij hoort)
alter table inschrijvingen add column if not exists inschrijf_bedrag numeric(8,2);

-- Logboek van wijzigingen door beheer, met eventuele taak (betalen / terugstorten)
create table if not exists wijzigingen (
  id                 uuid primary key default gen_random_uuid(),
  inschrijving_id    uuid references inschrijvingen(id) on delete set null,
  deelnemer_id       uuid,
  referentie         text not null,
  contact_naam       text not null,
  voornaam           text not null,
  email              text not null,
  telefoon           text not null,
  soort              text not null check (soort in ('persoon_toegevoegd', 'persoon_verwijderd', 'inschrijving_verwijderd')),
  toelichting        text not null,
  nieuw_totaal       numeric(8,2),
  nog_te_betalen     numeric(8,2),
  bedrag             numeric(8,2) not null default 0,
  taak               text check (taak in ('betalen', 'terugstorten')),
  afgehandeld        boolean not null default false,
  afgehandeld_op     timestamptz,
  vervallen          boolean not null default false,
  aangemaakt_op      timestamptz not null default now(),
  mail_verstuurd_op  timestamptz
);
alter table wijzigingen enable row level security;
create index if not exists wijzigingen_inschrijving_idx on wijzigingen (inschrijving_id);

-- Eenmalige overzetting van de eerdere tabellen betaalverzoeken / meldingen
do $$
begin
  if to_regclass('public.betaalverzoeken') is not null then
    update inschrijvingen i set inschrijf_bedrag = i.totaal_bedrag
      - coalesce((select sum(b.bedrag) from betaalverzoeken b where b.inschrijving_id = i.id), 0)
    where inschrijf_bedrag is null;
    insert into wijzigingen (inschrijving_id, referentie, contact_naam, voornaam, email, telefoon, soort,
                             toelichting, bedrag, taak, aangemaakt_op, mail_verstuurd_op)
    select i.id, i.referentie, concat_ws(' ', i.voornaam, i.tussenvoegsel, i.achternaam), i.voornaam, i.email, i.telefoon,
           'persoon_toegevoegd', b.toelichting, b.bedrag, 'betalen', b.aangemaakt_op, b.verstuurd_op
      from betaalverzoeken b join inschrijvingen i on i.id = b.inschrijving_id;
    drop table betaalverzoeken;
  end if;
  if to_regclass('public.meldingen') is not null then
    insert into wijzigingen (referentie, contact_naam, voornaam, email, telefoon, soort, toelichting,
                             nieuw_totaal, bedrag, taak, aangemaakt_op, mail_verstuurd_op)
    select m.referentie, m.voornaam, m.voornaam, m.email, '', m.soort,
           coalesce(m.toelichting, 'Inschrijving verwijderd'), m.nieuw_totaal, m.terug,
           case when m.terug > 0 then 'terugstorten' end, m.aangemaakt_op, m.verstuurd_op
      from meldingen m;
    drop table meldingen;
  end if;
end $$;
update inschrijvingen set inschrijf_bedrag = totaal_bedrag where inschrijf_bedrag is null;
alter table inschrijvingen drop column if exists betaald_bedrag;


create table if not exists beheer_instellingen (
  sleutel  text primary key,
  waarde   text not null
);

create table if not exists beheer_pogingen (
  id      bigserial primary key,
  tijd    timestamptz not null default now(),
  gelukt  boolean not null
);

-- RLS aan zonder policies: niemand behalve de eigenaar leest/schrijft direct.
alter table teams               enable row level security;
alter table inschrijvingen      enable row level security;
alter table deelnemers          enable row level security;
alter table beheer_instellingen enable row level security;
alter table beheer_pogingen     enable row level security;

-- ---------------------------------------------------------------
-- Prijslogica (leeftijd op wedstrijddatum 12-12-2026)
-- ---------------------------------------------------------------
create or replace function public.vvz_categorie(geb date)
returns text language sql immutable as $$
  select case when extract(year from age(date '2026-12-12', geb)) >= 16
              then '16+' else 't/m 15' end
$$;

create or replace function public.vvz_prijs(categorie text)
returns numeric language sql immutable as $$
  select case when categorie = '16+' then 19.50 else 12.50 end::numeric(6,2)
$$;

-- ---------------------------------------------------------------
-- Publiek: teamlijst ophalen
-- ---------------------------------------------------------------
drop function if exists public.teams();
create or replace function public.teams()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(naam order by volgorde), '[]'::jsonb) from teams
$$;

-- ---------------------------------------------------------------
-- Publiek: inschrijving opslaan (alles in één transactie)
-- ---------------------------------------------------------------
create or replace function public.registreer(contact jsonb, personen jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id      uuid;
  v_ref     text;
  v_totaal  numeric(8,2) := 0;
  v_jong    int := 0;
  v_oud     int := 0;
  p         jsonb;
  v_geb     date;
  v_cat     text;
begin
  if jsonb_typeof(personen) <> 'array'
     or jsonb_array_length(personen) < 1
     or jsonb_array_length(personen) > 30 then
    raise exception 'Geef 1 tot 30 deelnemers op.';
  end if;

  if coalesce(trim(contact->>'voornaam'), '') = ''
     or coalesce(trim(contact->>'achternaam'), '') = ''
     or coalesce(trim(contact->>'email'), '') = ''
     or coalesce(trim(contact->>'telefoon'), '') = '' then
    raise exception 'Vul alle verplichte gegevens van de contactpersoon in.';
  end if;

  -- Rem tegen misbruik: max. 5 inschrijvingen per e-mailadres per dag
  -- en max. 40 inschrijvingen in totaal per 10 minuten.
  if (select count(*) from inschrijvingen
      where email = lower(trim(contact->>'email'))
        and aangemaakt_op > now() - interval '1 day') >= 5 then
    raise exception 'Met dit e-mailadres zijn vandaag al meerdere inschrijvingen gedaan. Neem contact op met de organisatie.';
  end if;
  if (select count(*) from inschrijvingen
      where aangemaakt_op > now() - interval '10 minutes') >= 40 then
    raise exception 'Het is op dit moment erg druk. Probeer het over een paar minuten opnieuw.';
  end if;

  for i in 1..20 loop
    v_ref := 'VVZ-' || lpad((floor(random() * 100000))::int::text, 5, '0');
    exit when not exists (select 1 from inschrijvingen where referentie = v_ref);
  end loop;

  insert into inschrijvingen (referentie, voornaam, tussenvoegsel, achternaam, email, telefoon)
  values (v_ref,
          left(trim(contact->>'voornaam'), 100),
          nullif(left(trim(coalesce(contact->>'tussenvoegsel', '')), 30), ''),
          left(trim(contact->>'achternaam'), 100),
          lower(left(trim(contact->>'email'), 200)),
          left(trim(contact->>'telefoon'), 30))
  returning id into v_id;

  for p in select value from jsonb_array_elements(personen) loop
    begin
      v_geb := (p->>'geboortedatum')::date;
    exception when others then
      raise exception 'Ongeldige geboortedatum.';
    end;
    if v_geb is null or v_geb > date '2026-12-12' or v_geb < date '1900-01-01' then
      raise exception 'Ongeldige geboortedatum.';
    end if;
    if coalesce(trim(p->>'voornaam'), '') = '' or coalesce(trim(p->>'achternaam'), '') = '' then
      raise exception 'Vul voor iedere deelnemer voor- en achternaam in.';
    end if;
    if not exists (select 1 from teams where naam = p->>'team') then
      raise exception 'Kies voor iedere deelnemer een team.';
    end if;

    v_cat := vvz_categorie(v_geb);
    if v_cat = '16+' then v_oud := v_oud + 1; else v_jong := v_jong + 1; end if;

    insert into deelnemers (inschrijving_id, voornaam, achternaam, geboortedatum, team, categorie, prijs)
    values (v_id, left(trim(p->>'voornaam'), 100), left(trim(p->>'achternaam'), 100),
            v_geb, p->>'team', v_cat, vvz_prijs(v_cat));

    v_totaal := v_totaal + vvz_prijs(v_cat);
  end loop;

  update inschrijvingen set totaal_bedrag = v_totaal, inschrijf_bedrag = v_totaal where id = v_id;

  return jsonb_build_object(
    'referentie', v_ref,
    'totaal', v_totaal,
    'aantal_tm15', v_jong,
    'aantal_16plus', v_oud
  );
end $$;

-- ---------------------------------------------------------------
-- Beheer: wachtwoordcontrole met eenvoudige brute-force-rem
-- (max. 10 mislukte pogingen per 15 minuten)
-- ---------------------------------------------------------------
create or replace function public.beheer_check(wachtwoord text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash text;
  v_ok   boolean;
begin
  delete from beheer_pogingen where tijd < now() - interval '1 day';

  if (select count(*) from beheer_pogingen
      where not gelukt and tijd > now() - interval '15 minutes') >= 10 then
    return false;
  end if;

  select waarde into v_hash from beheer_instellingen where sleutel = 'wachtwoord_hash';
  v_ok := v_hash is not null and crypt(coalesce(wachtwoord, ''), v_hash) = v_hash;

  if not v_ok then
    insert into beheer_pogingen (gelukt) values (false);
  end if;
  return v_ok;
end $$;

create or replace function public.beheer_overzicht(wachtwoord text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Onjuist wachtwoord of te veel pogingen. Probeer het later opnieuw.');
  end if;

  return jsonb_build_object('ok', true,
    'verwijderd', coalesce((select jsonb_agg(to_jsonb(w) order by w.aangemaakt_op desc)
                            from wijzigingen w where w.inschrijving_id is null), '[]'::jsonb),
    'inschrijvingen', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'referentie', i.referentie,
      'aangemaakt_op', i.aangemaakt_op,
      'voornaam', i.voornaam,
      'tussenvoegsel', i.tussenvoegsel,
      'achternaam', i.achternaam,
      'email', i.email,
      'telefoon', i.telefoon,
      'totaal_bedrag', i.totaal_bedrag,
      'betaald', i.betaald,
      'betaald_op', i.betaald_op,
      'inschrijf_bedrag', i.inschrijf_bedrag,
      'wijzigingen', coalesce((
        select jsonb_agg(to_jsonb(w) order by w.aangemaakt_op)
        from wijzigingen w where w.inschrijving_id = i.id), '[]'::jsonb),
      'bevestiging_verstuurd_op', i.bevestiging_verstuurd_op,
      'deelnemers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id,
          'voornaam', d.voornaam,
          'achternaam', d.achternaam,
          'geboortedatum', d.geboortedatum,
          'team', d.team,
          'categorie', d.categorie,
          'prijs', d.prijs) order by d.achternaam, d.voornaam)
        from deelnemers d where d.inschrijving_id = i.id), '[]'::jsonb)
    ) order by i.aangemaakt_op desc)
    from inschrijvingen i), '[]'::jsonb));
end $$;

create or replace function public.beheer_zet_betaald(wachtwoord text, inschrijving uuid, is_betaald boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;

  update inschrijvingen
     set betaald = is_betaald,
         betaald_op = case when is_betaald then now() else null end
   where id = inschrijving;

  return jsonb_build_object('ok', found);
end $$;

-- ---------------------------------------------------------------
-- Beheer: contactpersoon aanpassen, personen toevoegen/verwijderen,
-- inschrijving verwijderen
-- ---------------------------------------------------------------
drop function if exists public.beheer_bewaar_deelnemer(text, uuid, uuid, jsonb);

create or replace function public.vvz_herbereken(p_inschrijving uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update inschrijvingen
     set totaal_bedrag = coalesce((select sum(prijs) from deelnemers where inschrijving_id = p_inschrijving), 0)
   where id = p_inschrijving
$$;

-- Wijziging vastleggen, met een kopie van de contactgegevens (blijft bewaard als de inschrijving weg is)
create or replace function public.vvz_log(p_insc uuid, p_soort text, p_toelichting text, p_bedrag numeric,
                                          p_taak text, p_deelnemer uuid default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into wijzigingen (inschrijving_id, deelnemer_id, referentie, contact_naam, voornaam, email, telefoon,
                           soort, toelichting, nieuw_totaal, nog_te_betalen, bedrag, taak)
  select i.id, p_deelnemer, i.referentie, concat_ws(' ', i.voornaam, i.tussenvoegsel, i.achternaam), i.voornaam,
         i.email, i.telefoon, p_soort, p_toelichting,
         case when p_soort = 'persoon_verwijderd' then i.totaal_bedrag end,
         case when p_soort = 'persoon_verwijderd' and not i.betaald then i.inschrijf_bedrag end,
         coalesce(p_bedrag, 0), p_taak
    from inschrijvingen i where i.id = p_insc
$$;

create or replace function public.beheer_wijzig_inschrijving(wachtwoord text, inschrijving uuid, contact jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;
  if coalesce(trim(contact->>'voornaam'), '') = '' or coalesce(trim(contact->>'achternaam'), '') = ''
     or coalesce(trim(contact->>'email'), '') = '' or coalesce(trim(contact->>'telefoon'), '') = '' then
    return jsonb_build_object('ok', false, 'fout', 'Voornaam, achternaam, e-mail en telefoon zijn verplicht.');
  end if;
  update inschrijvingen set
    voornaam      = left(trim(contact->>'voornaam'), 100),
    tussenvoegsel = nullif(left(trim(coalesce(contact->>'tussenvoegsel', '')), 30), ''),
    achternaam    = left(trim(contact->>'achternaam'), 100),
    email         = lower(left(trim(contact->>'email'), 200)),
    telefoon      = left(trim(contact->>'telefoon'), 30)
  where id = inschrijving;
  return jsonb_build_object('ok', found);
end $$;

-- Persoon toevoegen: wijziging met taak "betalen" (betaalverzoek gaat per mail)
create or replace function public.beheer_voeg_deelnemer_toe(wachtwoord text, inschrijving uuid, gegevens jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_geb   date;
  v_cat   text;
  v_prijs numeric(6,2);
  v_id    uuid;
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;
  if not exists (select 1 from inschrijvingen where id = inschrijving) then
    return jsonb_build_object('ok', false, 'fout', 'Inschrijving niet gevonden.');
  end if;
  begin
    v_geb := (gegevens->>'geboortedatum')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'fout', 'Ongeldige geboortedatum.');
  end;
  if v_geb is null or v_geb > date '2026-12-12' or v_geb < date '1900-01-01' then
    return jsonb_build_object('ok', false, 'fout', 'Ongeldige geboortedatum.');
  end if;
  if coalesce(trim(gegevens->>'voornaam'), '') = '' or coalesce(trim(gegevens->>'achternaam'), '') = '' then
    return jsonb_build_object('ok', false, 'fout', 'Voor- en achternaam zijn verplicht.');
  end if;
  if not exists (select 1 from teams where naam = gegevens->>'team') then
    return jsonb_build_object('ok', false, 'fout', 'Kies een geldig team.');
  end if;

  v_cat := vvz_categorie(v_geb);
  v_prijs := vvz_prijs(v_cat);

  insert into deelnemers (inschrijving_id, voornaam, achternaam, geboortedatum, team, categorie, prijs)
  values (inschrijving, left(trim(gegevens->>'voornaam'), 100), left(trim(gegevens->>'achternaam'), 100),
          v_geb, gegevens->>'team', v_cat, v_prijs)
  returning id into v_id;

  perform vvz_herbereken(inschrijving);
  perform vvz_log(inschrijving, 'persoon_toegevoegd',
    format('Toegevoegd: %s %s (%s)', trim(gegevens->>'voornaam'), trim(gegevens->>'achternaam'),
           case when v_cat = '16+' then 'vanaf 16 jaar' else 't/m 15 jaar' end),
    v_prijs, 'betalen', v_id);

  return jsonb_build_object('ok', true, 'bedrag', v_prijs);
end $$;

-- Persoon verwijderen. Per persoon:
--  * toegevoegd met nog open betaalverzoek  -> dat verzoek vervalt, niets terug
--  * oorspronkelijke persoon, inschrijving nog niet betaald -> te betalen inschrijfbedrag wordt lager
--  * al betaald -> taak "terugstorten"
-- Is het de laatste persoon, dan wordt de hele inschrijving verwijderd.
create or replace function public.beheer_verwijder_deelnemer(wachtwoord text, deelnemer uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_d      deelnemers%rowtype;
  v_i      inschrijvingen%rowtype;
  v_taak   wijzigingen%rowtype;
  v_terug  numeric(8,2) := 0;
  v_tekst  text;
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;
  select * into v_d from deelnemers where id = deelnemer;
  if v_d.id is null then
    return jsonb_build_object('ok', false, 'fout', 'Deelnemer niet gevonden.');
  end if;
  if (select count(*) from deelnemers where inschrijving_id = v_d.inschrijving_id) = 1 then
    return beheer_verwijder_inschrijving(wachtwoord, v_d.inschrijving_id);
  end if;

  select * into v_i from inschrijvingen where id = v_d.inschrijving_id;
  select * into v_taak from wijzigingen
   where deelnemer_id = v_d.id and taak = 'betalen' and not vervallen
   order by aangemaakt_op desc limit 1;
  v_tekst := format('Verwijderd: %s %s', v_d.voornaam, v_d.achternaam);

  if v_taak.id is not null and not v_taak.afgehandeld then
    update wijzigingen set vervallen = true where id = v_taak.id;
    v_tekst := v_tekst || format(' (betaalverzoek van € %s vervalt)', replace(v_d.prijs::text, '.', ','));
  elsif v_taak.id is null and not v_i.betaald then
    update inschrijvingen set inschrijf_bedrag = greatest(inschrijf_bedrag - v_d.prijs, 0) where id = v_i.id;
  else
    v_terug := v_d.prijs;
  end if;

  delete from deelnemers where id = v_d.id;
  perform vvz_herbereken(v_i.id);
  perform vvz_log(v_i.id, 'persoon_verwijderd', v_tekst, v_terug,
                  case when v_terug > 0 then 'terugstorten' end, v_d.id);
  return jsonb_build_object('ok', true, 'inschrijving_verwijderd', false, 'terug', v_terug);
end $$;

-- Hele inschrijving verwijderen; terug = alles wat (volgens de vinkjes) betaald is, min al geplande terugstortingen
create or replace function public.beheer_verwijder_inschrijving(wachtwoord text, inschrijving uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_i      inschrijvingen%rowtype;
  v_terug  numeric(8,2);
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;
  select * into v_i from inschrijvingen where id = inschrijving;
  if v_i.id is null then
    return jsonb_build_object('ok', false, 'fout', 'Inschrijving niet gevonden.');
  end if;

  v_terug := greatest(
      (case when v_i.betaald then v_i.inschrijf_bedrag else 0 end)
    + coalesce((select sum(bedrag) from wijzigingen where inschrijving_id = v_i.id
                and taak = 'betalen' and afgehandeld and not vervallen), 0)
    - coalesce((select sum(bedrag) from wijzigingen where inschrijving_id = v_i.id
                and taak = 'terugstorten' and not vervallen), 0), 0);

  update wijzigingen set vervallen = true
   where inschrijving_id = v_i.id and taak = 'betalen' and not afgehandeld;

  perform vvz_log(v_i.id, 'inschrijving_verwijderd',
    format('Inschrijving verwijderd (%s deelnemers)', (select count(*) from deelnemers where inschrijving_id = v_i.id)),
    v_terug, case when v_terug > 0 then 'terugstorten' end);
  delete from inschrijvingen where id = v_i.id;
  return jsonb_build_object('ok', true, 'inschrijving_verwijderd', true, 'terug', v_terug);
end $$;

-- Taak afvinken (betaald / teruggestort)
create or replace function public.beheer_zet_taak(wachtwoord text, wijziging uuid, is_afgehandeld boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not beheer_check(wachtwoord) then
    return jsonb_build_object('ok', false, 'fout', 'Niet ingelogd.');
  end if;
  update wijzigingen
     set afgehandeld = is_afgehandeld,
         afgehandeld_op = case when is_afgehandeld then now() end
   where id = wijziging and taak is not null and not vervallen;
  return jsonb_build_object('ok', found);
end $$;

-- ---------------------------------------------------------------
-- Rechten: publiek mag alléén de functies hierboven aanroepen
-- ---------------------------------------------------------------
revoke all on all tables in schema public from public;
revoke execute on all functions in schema public from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anonymous') then
    revoke all on all tables in schema public from anonymous;
    revoke execute on all functions in schema public from anonymous;
    grant usage on schema public to anonymous;
    grant execute on function
      public.teams(),
      public.registreer(jsonb, jsonb),
      public.beheer_overzicht(text),
      public.beheer_zet_betaald(text, uuid, boolean),
      public.beheer_wijzig_inschrijving(text, uuid, jsonb),
      public.beheer_verwijder_inschrijving(text, uuid),
      public.beheer_voeg_deelnemer_toe(text, uuid, jsonb),
      public.beheer_verwijder_deelnemer(text, uuid),
      public.beheer_zet_taak(text, uuid, boolean)
    to anonymous;
  else
    raise notice 'Rol "anonymous" bestaat nog niet: zet eerst de Data API aan en draai de migratie opnieuw.';
  end if;

  -- Zelfde beperkte rechten voor "authenticated", voor het geval een token zonder role-claim binnenkomt
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke execute on all functions in schema public from authenticated;
    grant usage on schema public to authenticated;
    grant execute on function
      public.teams(),
      public.registreer(jsonb, jsonb),
      public.beheer_overzicht(text),
      public.beheer_zet_betaald(text, uuid, boolean),
      public.beheer_wijzig_inschrijving(text, uuid, jsonb),
      public.beheer_verwijder_inschrijving(text, uuid),
      public.beheer_voeg_deelnemer_toe(text, uuid, jsonb),
      public.beheer_verwijder_deelnemer(text, uuid),
      public.beheer_zet_taak(text, uuid, boolean)
    to authenticated;
  end if;
end $$;

-- Data API (PostgREST) de nieuwe functies laten inlezen, i.p.v. handmatig "Refresh schema cache"
notify pgrst, 'reload schema';
