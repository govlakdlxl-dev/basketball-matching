import {test,expect} from '@playwright/test';
test('공식 시설은 실제 모집과 구분되고 이름은 문자로 표시된다',async({page})=>{
 await page.goto('/#/matches');
 await expect(page.getByRole('heading',{name:'지금 모집 중인 경기',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'지금 모집 중인 경기',exact:true})).toHaveCount(1);
 await expect(page.getByText('서울교육문화센터 실내체육관(농구장)',{exact:true})).toBeVisible();
 await expect(page.getByText('인천삼산월드체육관 보조경기장',{exact:true})).toBeVisible();
 await expect(page.getByText('시설 등록은 경기 모집·대관 확정을 뜻하지 않아요.',{exact:true})).toBeVisible();
 await page.screenshot({path:'artifacts/개선화면-실제농구장.png',fullPage:true,style:'body{position:relative}.tabs{position:absolute}'});
 await page.route('**/api/facilities',route=>route.fulfill({json:[{id:'evil-name',name:'<img src=x onerror=alert(1)>',address:'서울 성동구',point:{lat:37.5,lng:127},region:'seoul',registration:'manual_pin',locationStatus:'unverified',basketballUseStatus:'unverified',verifiedAt:null,sourceUrl:null}]}));
 await page.reload();
 await expect(page.getByText('<img src=x onerror=alert(1)>',{exact:true})).toBeVisible();
 await expect(page.locator('#content img')).toHaveCount(0);
});
