create table public.test_orders (
 id uuid primary key default gen_random_uuid(),application_id uuid not null unique references public.applications(id),
 match_id uuid not null references public.matches(id),team_id uuid not null references public.teams(id),owner_id uuid not null references public.profiles(id),
 environment text not null default 'test' check(environment='test'),terms jsonb not null,pricing_version text not null default 'initial-test-v1',
 payment_amount_krw bigint not null check(payment_amount_krw between 1 and 9007199254740991),payment_deadline_at timestamptz not null,
 status text not null default 'created' check(status in ('created','approval_pending','paid','failed','unknown','needs_review')),
 created_at timestamptz not null default public.server_now()
);
create table public.approval_attempts (
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.test_orders(id),payment_key text not null unique,
 received_at timestamptz not null,pg_request_id uuid not null unique default gen_random_uuid(),
 status text not null default 'approval_pending' check(status in ('approval_pending','paid','failed','unknown','needs_review')),
 receipt jsonb not null,lease_until timestamptz,updated_at timestamptz not null default public.server_now(),evidence jsonb,error_code text
);
alter table public.test_orders enable row level security;
alter table public.approval_attempts enable row level security;
revoke all on public.test_orders,public.approval_attempts from public,anon,authenticated;
grant all on public.test_orders,public.approval_attempts to service_role;
create or replace function public.test_order_json(o public.test_orders) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',o.id,'applicationId',o.application_id,'teamId',o.team_id,'ownerId',o.owner_id,'environment',o.environment,'terms',o.terms,'pricingVersion',o.pricing_version,'paymentDeadlineAt',public.utc_text(o.payment_deadline_at),'status',o.status)
$$;
create or replace function public.api_create_test_order(p_actor uuid,p_application uuid,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.applications;m public.matches;o public.test_orders;v_match uuid;cached jsonb;result jsonb;p jsonb;
begin
 perform public.require_active_actor(p_actor);select match_id into v_match from public.applications where id=p_application;if not found then raise exception 'NOT_FOUND';end if;
 select * into m from public.matches where id=v_match for update;select * into a from public.applications where id=p_application for update;
 if a.applicant_id<>p_actor then raise exception 'FORBIDDEN';end if;
 cached:=public.begin_command(p_actor,'create_test_order',p_request_id,jsonb_build_object('applicationId',p_application));if cached is not null then return cached;end if;
 if a.state not in ('awaiting_payment','verifying_payment') then raise exception 'INVALID_STATE';end if;
 if m.hidden or m.recruitment_status<>'open' or not exists(select 1 from public.teams where id=m.team_id and status='approved') then raise exception 'MATCH_STARTED';end if;
 if not public.format_is_acknowledged(a.id,m.id) then raise exception 'FORMAT_CHANGED';end if;
 select * into o from public.test_orders where application_id=a.id for update;
 if not found then
  if a.payment_deadline_at<=public.server_now() then raise exception 'PAYMENT_DEADLINE_EXPIRED';end if;
  p:=a.terms->'pricing';
  if p->>'purpose'<>'initial_test_order' or p->>'currency'<>'KRW' or (p->>'platformRateBps')::numeric<>0 or (p->>'platformFeeKrw')::numeric<>0 or (p->>'participantFeeKrw')::numeric<>0 or (p->>'teamFeeKrw')::numeric<>0 or (p->>'paymentAmountKrw')::numeric<>(p->>'baseFeeKrw')::numeric or (p->>'teamBasisKrw')::numeric<>(p->>'baseFeeKrw')::numeric then raise exception 'INVALID_TEST_PRICING';end if;
  if (p->>'paymentAmountKrw')::numeric<=0 or (p->>'paymentAmountKrw')::numeric>9007199254740991 then raise exception 'INVALID_TEST_PRICING';end if;
  insert into public.test_orders(application_id,match_id,team_id,owner_id,terms,payment_amount_krw,payment_deadline_at) values(a.id,m.id,m.team_id,p_actor,a.terms,(p->>'paymentAmountKrw')::bigint,a.payment_deadline_at) returning * into o;
 end if;
 result:=public.test_order_json(o);perform public.finish_command(p_actor,'create_test_order',p_request_id,result);return result;
end $$;
create or replace function public.api_accept_approval(p_actor uuid,p_order uuid,p_payment_key text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.test_orders;a public.applications;m public.matches;r public.approval_attempts;cached jsonb;result jsonb;v_now timestamptz;
begin
 perform public.require_active_actor(p_actor);select * into o from public.test_orders where id=p_order;if not found then raise exception 'NOT_FOUND';end if;
 if o.owner_id<>p_actor then raise exception 'FORBIDDEN';end if;
 select * into m from public.matches where id=o.match_id for update;select * into a from public.applications where id=o.application_id for update;select * into o from public.test_orders where id=p_order for update;
 cached:=public.begin_command(p_actor,'accept_approval',p_request_id,jsonb_build_object('orderId',p_order,'paymentKey',p_payment_key));if cached is not null then return cached;end if;
 select * into r from public.approval_attempts where order_id=o.id for update;
 if found then
  if r.payment_key<>p_payment_key then raise exception 'REQUEST_ID_CONFLICT';end if;result:=r.receipt;
 else
  v_now:=public.server_now();if v_now>=o.payment_deadline_at then raise exception 'PAYMENT_DEADLINE_EXPIRED';end if;
  if a.state<>'awaiting_payment' then raise exception 'INVALID_STATE';end if;
  if m.hidden or m.recruitment_status<>'open' or m.starts_at<=v_now or not exists(select 1 from public.teams where id=m.team_id and status='approved') then raise exception 'MATCH_STARTED';end if;
  if not public.format_is_acknowledged(a.id,m.id) then raise exception 'FORMAT_CHANGED';end if;
  if p_payment_key !~ '^[A-Za-z0-9_-]{10,200}$' then raise exception 'INVALID_INPUT';end if;
  insert into public.approval_attempts(order_id,payment_key,received_at,receipt) values(o.id,p_payment_key,v_now,'{}') returning * into r;
  result:=jsonb_build_object('attemptId',r.id,'orderId',o.id,'receivedAt',public.utc_text(r.received_at),'status','approval_pending');update public.approval_attempts set receipt=result where id=r.id;
  update public.applications set state='verifying_payment' where id=a.id;update public.test_orders set status='approval_pending' where id=o.id;
  insert into public.activity_records(scope,kind,match_id,application_id,actor_id,payload) values('audit','payment.approval_received',m.id,a.id,p_actor,jsonb_build_object('orderId',o.id,'attemptId',r.id));
 end if;
 perform public.finish_command(p_actor,'accept_approval',p_request_id,result);return result;
end $$;
create or replace function public.api_get_test_order(p_actor uuid,p_order uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.test_orders;
begin
 perform public.require_active_actor(p_actor);select * into o from public.test_orders where id=p_order;if not found then raise exception 'NOT_FOUND';end if;
 if o.owner_id<>p_actor then raise exception 'FORBIDDEN';end if;return public.test_order_json(o);
end $$;
revoke all on function public.test_order_json(public.test_orders),public.api_create_test_order(uuid,uuid,text),public.api_accept_approval(uuid,uuid,text,text),public.api_get_test_order(uuid,uuid) from public,anon,authenticated;
grant execute on function public.test_order_json(public.test_orders),public.api_create_test_order(uuid,uuid,text),public.api_accept_approval(uuid,uuid,text,text),public.api_get_test_order(uuid,uuid) to service_role;
