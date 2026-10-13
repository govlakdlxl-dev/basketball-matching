import type {AuthActor,TestOrder,ApprovalReceipt} from '@basket/core/contracts';
import type {Database} from '../../infra/database';
import {ApiError} from '../../http/auth';
import {idField} from '../matches/commands';
import {textField} from '../accounts/handlers';
function only(input:Record<string,unknown>,keys:string[]){if(Object.keys(input).some(key=>!keys.includes(key)))throw new ApiError('INVALID_INPUT',400);}
export function createPaymentCommands(database:Database){return {
 createTestOrder(actor:AuthActor,input:Record<string,unknown>):Promise<TestOrder>{only(input,['applicationId','requestId']);return database.rpc('api_create_test_order',{p_actor:actor.userId,p_application:idField(input.applicationId),p_request_id:textField(input.requestId,128)});},
 acceptApproval(actor:AuthActor,input:Record<string,unknown>):Promise<ApprovalReceipt>{only(input,['orderId','paymentKey','requestId']);const paymentKey=textField(input.paymentKey,200);if(!/^[A-Za-z0-9_-]{10,200}$/.test(paymentKey))throw new ApiError('INVALID_INPUT',400);return database.rpc('api_accept_approval',{p_actor:actor.userId,p_order:idField(input.orderId),p_payment_key:paymentKey,p_request_id:textField(input.requestId,128)});},
};}
