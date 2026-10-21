import type {DeliveryPort,DeliveryResult} from '@basket/core/notifications/contracts';
export class DisabledAlimtalkAdapter implements DeliveryPort{async send():Promise<DeliveryResult>{return {status:'setup_required',providerMessageId:null,reason:'ALIMTALK_PROVIDER_NOT_CONFIGURED'};}}
