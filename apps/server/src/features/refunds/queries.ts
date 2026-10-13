import type {AuthActor,RefundRecord} from '@basket/core/contracts';
import type {Database} from '../../infra/database';
import {idField} from '../matches/commands';
export function createRefundQueries(database:Database){return {getRefundRecord(actor:AuthActor,orderId:unknown):Promise<RefundRecord|null>{return database.rpc('api_get_refund_record',{p_actor:actor.userId,p_order:idField(orderId)});}};}
