self.addEventListener('push',event=>{event.waitUntil((async()=>{
 let data;try{data=event.data?.json();}catch{return;}
 const ids=Array.isArray(data?.noticeIds)?data.noticeIds.filter(id=>typeof id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)):[];
 if(!ids.length)return;
 await self.registration.showNotification('농구 매칭',{body:'새 안내가 있습니다. 앱 또는 웹에서 확인해 주세요.',tag:'basket-'+ids[0],data:{noticeId:ids[0]}});
})());});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{
 const id=event.notification.data?.noticeId;if(typeof id!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))return;
 const url=new URL('/#/notifications/'+id,self.location.origin);const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 const tab=tabs.find(client=>new URL(client.url).origin===url.origin);if(tab){await tab.navigate(url.href);await tab.focus();}else await self.clients.openWindow(url.href);
})());});
