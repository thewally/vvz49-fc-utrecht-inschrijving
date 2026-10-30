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
  ('O9-1', 21), ('O9-2', 22), ('O8-1', 23), ('O8-2', 24)
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
    raise exception 'Geef 1 tot 30 personen op.';
  end if;

  if coalesce(trim(contact->>'voornaam'), '') = ''
     or coalesce(trim(contact->>'achternaam'), '') = ''
     or coalesce(trim(contact->>'email'), '') = ''
     or coalesce(trim(contact->>'telefoon'), '') = '' then
    raise exception 'Vul alle verplichte gegevens van de contactpersoon in.';
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
      raise exception 'Vul voor iedere persoon voor- en achternaam in.';
    end if;
    if not exists (select 1 from teams where naam = p->>'team') then
      raise exception 'Kies voor iedere persoon een team.';
    end if;

    v_cat := vvz_categorie(v_geb);
    if v_cat = '16+' then v_oud := v_oud + 1; else v_jong := v_jong + 1; end if;

    insert into deelnemers (inschrijving_id, voornaam, achternaam, geboortedatum, team, categorie, prijs)
    values (v_id, left(trim(p->>'voornaam'), 100), left(trim(p->>'achternaam'), 100),
            v_geb, p->>'team', v_cat, vvz_prijs(v_cat));

    v_totaal := v_totaal + vvz_prijs(v_cat);
  end loop;

  update inschrijvingen set totaal_bedrag = v_totaal where id = v_id;

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

  return jsonb_build_object('ok', true, 'inschrijvingen', coalesce((
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
      'bevestiging_verstuurd_op', i.bevestiging_verstuurd_op,
      'deelnemers', coalesce((
        select jsonb_agg(jsonb_build_object(
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
      public.beheer_zet_betaald(text, uuid, boolean)
    to anonymous;
  else
    raise notice 'Rol "anonymous" bestaat nog niet: zet eerst de Data API aan en draai de migratie opnieuw.';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke execute on all functions in schema public from authenticated;
  end if;
end $$;
