export function el<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string) {
 const node=document.createElement(tag);node.className=className;if(text!==undefined) node.textContent=text;return node;
}
export const positionNames={guard:'가드',forward:'포워드',center:'센터'} as const;
export const stateNames={pending:'수락 대기',awaiting_payment:'결제 대기',verifying_payment:'결제 확인 중',confirmed:'참가 확정',rejected:'신청 거절',expired:'기한 만료',cancelled:'취소'} as const;
export function dateLabel(instant:string) {return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'short'}).format(new Date(instant));}
export function timeLabel(instant:string) {return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(instant));}
export function feeLabel(won:number) {return won===0?'무료':`${won.toLocaleString('ko-KR')}원`;}
export function actionError(error:unknown) {
 const code=error instanceof Error?error.message:'';
 return ({CAPACITY_FULL:'다른 신청자가 먼저 수락됐어요. 남은 자리를 확인해 주세요.',MATCH_STARTED:'경기가 시작됐거나 모집을 마감했어요.',NO_POSITION:'선택한 포지션의 모집 자리가 없어요.',FORMAT_CHANGED:'경기 방식이 변경됐어요. 변경 안내를 먼저 확인해 주세요.',FORBIDDEN:'현재 팀의 담당자 권한을 확인해 주세요.',UNAUTHORIZED:'로그인 후 이용해 주세요.',INVALID_STATE:'신청 상태가 바뀌었어요. 다시 확인해 주세요.'} as Record<string,string>)[code] || '요청을 처리하지 못했어요. 연결과 입력을 확인해 주세요.';
}
