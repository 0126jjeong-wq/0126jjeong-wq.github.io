// Web manages existing app imports. It never accepts a new Instagram URL.
export function renderReelManager({container, rows, restaurants, library, changed, notify}) {
  container.replaceChildren();
  const heading=document.createElement('h2');heading.textContent='앱에서 공유한 릴스';
  const intro=document.createElement('p');intro.textContent='인스타그램에서 릴스맵 앱으로 공유한 링크를 확인하고 관리하세요.';
  container.append(heading,intro);
  if(!rows.length){const empty=document.createElement('p');empty.textContent='아직 공유한 릴스가 없어요. 인스타그램의 공유 → 릴스맵 앱에서 보관해 주세요.';container.append(empty);return;}
  for(const entry of rows){
    const card=document.createElement('article');card.className='card';
    const title=document.createElement('h3');title.textContent=entry.place?.name||'가게 연결 전 릴스';
    const address=document.createElement('p');address.textContent=entry.place?.address||'앱에서 공유한 릴스예요. 연결할 가게를 선택할 수 있어요.';
    const link=document.createElement('a');link.textContent='Instagram에서 확인 ↗';link.href=entry.url;link.target='_blank';link.rel='noopener noreferrer';
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='정보 수정';details.append(summary);
    const form=document.createElement('form');form.className='profile-form';
    const chooseLabel=document.createElement('label');chooseLabel.textContent='연결할 가게';
    const choose=document.createElement('select');choose.setAttribute('aria-label','연결할 가게');
    const keep=document.createElement('option');keep.value='';keep.textContent=entry.place?'현재 가게 유지':'가게 선택';choose.append(keep);
    for(const place of restaurants){const option=document.createElement('option');option.value=String(place.id);option.textContent=place.name+' · '+(place.address||'');choose.append(option);}
    chooseLabel.append(choose);
    const nameLabel=document.createElement('label');nameLabel.textContent='내 보관함의 가게명';const name=document.createElement('input');name.required=true;name.maxLength=120;name.value=entry.place?.name||'';nameLabel.append(name);
    const categoryLabel=document.createElement('label');categoryLabel.textContent='카테고리';const category=document.createElement('select');for(const text of ['식사','일식','양식','카페·디저트','술집']){const option=document.createElement('option');option.value=option.textContent=text;category.append(option);}category.value=entry.place?.category||'식사';categoryLabel.append(category);
    const location=document.createElement('p');location.textContent='연결 주소: '+(entry.place?.address||'가게를 선택해 주세요.');
    const note=document.createElement('p');note.textContent='내 보관함의 정보만 수정됩니다. 주소·위치는 연결할 가게를 바꾸면 함께 변경됩니다.';
    choose.addEventListener('change',()=>{const place=restaurants.find(r=>String(r.id)===choose.value)||entry.place;name.value=place?.name||'';category.value=place?.category||'식사';location.textContent='연결 주소: '+(place?.address||'가게를 선택해 주세요.');});
    const submit=document.createElement('button');submit.type='submit';submit.className='profile-save';submit.textContent='수정 내용 저장';
    const status=document.createElement('p');status.setAttribute('role','status');
    form.append(chooseLabel,nameLabel,categoryLabel,location,note,submit,status);details.append(form);
    const remove=document.createElement('button');remove.type='button';remove.className='reel-btn';remove.textContent='내 보관함에서 삭제';
    let busy=false;
    form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;const owner=library.owner;if(!owner){notify('로그인 후 이용해 주세요.');return;}
      const original=restaurants.find(r=>String(r.id)===choose.value)||entry.place;
      if(!original||!Number.isFinite(original.latitude)||!Number.isFinite(original.longitude)){status.textContent='위치가 확인된 가게를 선택해 주세요.';return;}
      const updated={...original,id:String(original.id),name:name.value.trim(),category:category.value,reels:[]};if(!updated.name){name.focus();return;}
      busy=true;submit.disabled=remove.disabled=true;
      try{await library.updateReel(entry.url,updated);if(library.owner!==owner)return;await changed();notify('보관함 정보를 수정했어요.');}
      catch{status.textContent='수정하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';}
      finally{busy=false;submit.disabled=remove.disabled=false;}
    });
    remove.addEventListener('click',async()=>{if(busy)return;const owner=library.owner;if(!owner){notify('로그인 후 이용해 주세요.');return;}busy=true;submit.disabled=remove.disabled=true;
      try{await library.removeReel(entry.url);if(library.owner!==owner)return;await changed();notify('내 보관함에서 삭제했어요.');}
      catch{status.textContent='삭제하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';details.open=true;}
      finally{busy=false;submit.disabled=remove.disabled=false;}
    });
    card.append(title,address,link,details,remove);container.append(card);
  }
}
