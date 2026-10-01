-- Server-only admission accounting; no transactions, case bytes or user data.
create schema raven_private;
revoke all on schema raven_private from public, anon, authenticated;
grant usage on schema raven_private to service_role;
create table raven_private.admission_policy (
 kind text primary key check (kind in ('run','fetch')),
 minute_limit integer not null check (minute_limit between 1 and 10000),
 day_limit integer not null check (day_limit between minute_limit and 10000),
 enabled boolean not null default false
);
create table raven_private.admission_events (
 kind text not null references raven_private.admission_policy(kind),
 admitted_at timestamptz not null
);
create index admission_events_kind_time on raven_private.admission_events(kind,admitted_at);
alter table raven_private.admission_policy enable row level security;
alter table raven_private.admission_events enable row level security;
revoke all on all tables in schema raven_private from public,anon,authenticated,service_role;
grant select,update on raven_private.admission_policy to service_role;
grant select,insert,delete on raven_private.admission_events to service_role;
-- Prepared defaults; disabled until public-host activation is approved.
insert into raven_private.admission_policy values ('run',3,300,false),('fetch',20,2000,false);
create function public.raven_acquire_permit(p_kind text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare policy raven_private.admission_policy%rowtype; tick timestamptz; recent bigint; daily bigint;
begin
 if p_kind is null or p_kind not in ('run','fetch') then raise exception 'INVALID_BUDGET_KIND'; end if;
 -- Lock the existing policy row, serializing all instances for this operation.
 select * into policy from raven_private.admission_policy where kind=p_kind for update;
 if not found or not policy.enabled then raise exception 'BUDGET_UNAVAILABLE'; end if;
 tick := clock_timestamp();
 delete from raven_private.admission_events where kind=p_kind and admitted_at<=tick-interval '24 hours';
 select count(*) filter(where admitted_at>tick-interval '60 seconds'),count(*) into recent,daily
 from raven_private.admission_events where kind=p_kind;
 if recent>=policy.minute_limit or daily>=policy.day_limit then return false; end if;
 insert into raven_private.admission_events values(p_kind,tick);
 return true;
end;
$$;
revoke all on function public.raven_acquire_permit(text) from public,anon,authenticated;
grant execute on function public.raven_acquire_permit(text) to service_role;
