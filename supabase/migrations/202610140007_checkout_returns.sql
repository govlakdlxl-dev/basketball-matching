create table private.checkout_tickets(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.test_orders(id),token_hash text not null unique,nonce uuid not null default gen_random_uuid(),expires_at timestamptz not null,created_at timestamptz not null default public.server_now());
revoke all on private.checkout_tickets from public,anon,authenticated;grant all on private.checkout_tickets to service_role;
create or replace function public.api_create_checkout_ticket(p_actor uuid,p_order uuid,p_request_id text,p_token text,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.test_orders;a public.applications;t private.checkout_tickets;cached jsonb;result jsonb;
begin
 perform public.require_active_actor(p_actor);select * into o from public.test_orders where id=p_order;if not found then raise exception 'NOT_FOUND';end if;if o.owner_id<>p_actor then raise exception 'FORBIDDEN';end if;
 perform 1 from public.matches where id=o.match_id for update;select * into a from public.applications where id=o.application_id for update;select * into o from public.test_orders where id=p_order for update;
 cached:=public.begin_command(p_actor,'checkout_ticket',p_request_id,jsonb_build_object('orderId',p_order));if cached is not null then return cached;end if;
 if a.state<>'awaiting_payment' or o.status<>'created' then raise exception 'INVALID_STATE';end if;
 if public.server_now()>=o.payment_deadline_at then raise exception 'PAYMENT_DEADLINE_EXPIRED';end if;
 if not public.format_is_acknowledged(a.id,o.match_id) then raise exception 'FORMAT_CHANGED';end if;
 insert into private.checkout_tickets(order_id,token_hash,expires_at) values(o.id,p_hash,least(o.payment_deadline_at,public.server_now()+interval '15 minutes')) returning * into t;
 result:=jsonb_build_object('orderId',o.id,'amountKrw',o.payment_amount_krw,'returnToken',p_token,'nonce',t.nonce,'expiresAt',public.utc_text(t.expires_at));perform public.finish_command(p_actor,'checkout_ticket',p_request_id,result);return result;
end $$;
create or replace function public.api_resolve_checkout(p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare t private.checkout_tickets;o public.test_orders;r public.approval_attempts;
begin
 select * into t from private.checkout_tickets where token_hash=p_hash;if not found then raise exception 'NOT_FOUND';end if;select * into o from public.test_orders where id=t.order_id;select * into r from public.approval_attempts where order_id=o.id;
 if public.server_now()>=t.expires_at and r.id is null then raise exception 'PAYMENT_DEADLINE_EXPIRED';end if;
 if public.server_now()>=t.created_at+interval '1 hour' then raise exception 'PAYMENT_DEADLINE_EXPIRED';end if;
 return jsonb_build_object('ticketId',t.id,'orderId',o.id,'ownerId',o.owner_id,'amountKrw',o.payment_amount_krw,'nonce',t.nonce,'expiresAt',public.utc_text(t.expires_at),'status',o.status);
end $$;
create or replace function public.api_my_test_orders(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin perform public.require_active_actor(p_actor);return coalesce((select jsonb_agg(public.test_order_json(o) order by created_at desc) from public.test_orders o where owner_id=p_actor),'[]');end$$;
revoke all on function public.api_create_checkout_ticket(uuid,uuid,text,text,text),public.api_resolve_checkout(text),public.api_my_test_orders(uuid) from public,anon,authenticated;
grant execute on function public.api_create_checkout_ticket(uuid,uuid,text,text,text),public.api_resolve_checkout(text),public.api_my_test_orders(uuid) to service_role;
create or replace function public.api_operator_test_ledger(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_active_actor(p_actor);if not public.is_operator(p_actor) then raise exception 'FORBIDDEN';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('orderId',o.id,'environment',o.environment,'paymentStatus',o.status,'baseFeeKrw',o.terms->'pricing'->'baseFeeKrw','platformFeeKrw',o.terms->'pricing'->'platformFeeKrw','paymentAmountKrw',o.payment_amount_krw,'teamBasisKrw',o.terms->'pricing'->'teamBasisKrw','pgCost',o.terms->'pricing'->'pgCost','refund',case when r.id is not null then public.refund_json(r) else null end) order by o.created_at desc) from public.test_orders o left join public.refund_records r on r.order_id=o.id),'[]');
end $$;
revoke all on function public.api_operator_test_ledger(uuid) from public,anon,authenticated;grant execute on function public.api_operator_test_ledger(uuid) to service_role;
create or replace function public.api_my_format_notices(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_active_actor(p_actor);
 return coalesce((select jsonb_agg(jsonb_build_object('applicationId',a.id,'notice',public.format_notice_json(n),'acknowledged',exists(select 1 from public.format_acknowledgements ack where ack.notice_id=n.id and ack.application_id=a.id),'declined',exists(select 1 from public.cancellation_receipts c where c.application_id=a.id and c.cause='format_change_declined' and c.format_change_id=n.id)) order by n.announced_at desc) from public.applications a join public.format_notices n on n.match_id=a.match_id and a.id=any(n.affected_application_ids) where a.applicant_id=p_actor),'[]');
end $$;
