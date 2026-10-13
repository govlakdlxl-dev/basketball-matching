import type {TestOrder} from '@basket/core/contracts';
import {api,session} from '../auth/session';
export type Checkout={orderId:string;amountKrw:number;returnToken:string;nonce:string;expiresAt:string;provider:'fake'|'toss_test';clientKey:string|null};
export const pendingPaymentKey='basket.payment.pending';
export async function handlePaymentReturn(input:string):Promise<TestOrder|null>{
 const url=new URL(input);if(url.origin!==location.origin||!['/payment-return/success','/payment-return/fail'].includes(url.pathname))throw new Error('INVALID_PAYMENT_RETURN');
 const token=url.searchParams.get('token'),nonce=url.searchParams.get('nonce');if(!token||!nonce)throw new Error('INVALID_PAYMENT_RETURN');
 const pending=sessionStorage.getItem(pendingPaymentKey);if(pending){const p=JSON.parse(pending) as Checkout;if(p.returnToken!==token||p.nonce!==nonce)throw new Error('INVALID_PAYMENT_RETURN');}
 if(url.pathname.endsWith('/fail'))return null;
 const orderId=url.searchParams.get('orderId'),paymentKey=url.searchParams.get('paymentKey'),amount=Number(url.searchParams.get('amount'));
 if(!orderId||!paymentKey||!Number.isSafeInteger(amount)||amount<=0)throw new Error('INVALID_PAYMENT_RETURN');
 await api('/payments/return','POST',{token,orderId,paymentKey,amount});
 if(!session())return null;
 try{return await api<TestOrder>(`/test-orders/${orderId}`);}catch{return null;}
}
