import {test,expect,vi,afterEach} from 'vitest';
import {createTossTestAdapter} from '../../apps/server/src/features/payments/toss-test';
afterEach(()=>vi.unstubAllGlobals());
test('live 키·mode와 새 결제창 계열 키를 개별 API 설정에서 거부한다',()=>{
 for(const key of ['live_sk_secret','test_gsk_other',''])expect(()=>createTossTestAdapter({mode:'test',secretKey:key})).toThrow('INVALID_TEST_PG_CONFIG');
 expect(()=>createTossTestAdapter({mode:'live' as 'test',secretKey:'test_sk_secret'})).toThrow('INVALID_TEST_PG_CONFIG');
});
test('카드 취소 완료 증거만 합산하고 승인 POST에 고정 멱등 키를 전달한다',async()=>{
 const mock=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>Response.json({paymentKey:'test_payment_key',orderId:'order',totalAmount:10000,balanceAmount:5000,currency:'KRW',status:'PARTIAL_CANCELED',method:'카드',cancels:[{transactionKey:'done',cancelAmount:5000,cancelStatus:'DONE'},{transactionKey:'pending',cancelAmount:100,cancelStatus:'PENDING'}]}));vi.stubGlobal('fetch',mock);
 const pg=createTossTestAdapter({mode:'test',secretKey:'test_sk_secret'}),result=await pg.approve({orderId:'order',paymentKey:'test_payment_key',amountKrw:10000,requestId:'same-request'});
 expect(result).toMatchObject({kind:'confirmed',evidence:{approved:true,refundedKrw:5000,refunds:[{providerRefundId:'done',requestId:null,amountKrw:5000}]}});
 expect(mock.mock.calls[0]?.[1]).toMatchObject({method:'POST',headers:expect.objectContaining({'Idempotency-Key':'same-request'})});
});
test('응답 손상·5xx·처리 중·승인 이력 없음은 확정 실패로 가장하지 않는다',async()=>{
 const pg=createTossTestAdapter({mode:'test',secretKey:'test_sk_secret'});
 for(const response of [new Response('broken'),Response.json({code:'UNKNOWN'},{status:500}),Response.json({code:'IDEMPOTENT_REQUEST_PROCESSING'},{status:409}),Response.json({code:'NOT_FOUND_PAYMENT'},{status:404})]){vi.stubGlobal('fetch',vi.fn(async()=>response));expect((await pg.lookup({orderId:'order',paymentKey:'test_payment_key'})).kind).toBe('unknown');}
});
