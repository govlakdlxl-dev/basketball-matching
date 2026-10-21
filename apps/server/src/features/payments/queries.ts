import type {AuthActor,TestOrder} from '@basket/core/contracts';
import type {Database} from '../../infra/database';
import {idField} from '../matches/commands';
export function createPaymentQueries(database:Database){return {getTestOrder(actor:AuthActor,orderId:unknown):Promise<TestOrder>{return database.rpc('api_get_test_order',{p_actor:actor.userId,p_order:idField(orderId)});}};}
