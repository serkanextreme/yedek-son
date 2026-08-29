
#!/usr/bin/env python3
"""Regression endpoint checks for task create/status/reminder/edit after bug69 UI tests."""
import json, os, uuid, requests
from pathlib import Path
BASE=os.environ.get('SERTEST_BASE','https://functional-themes.preview.emergentagent.com').rstrip('/')
API=BASE+'/api'
OUT=Path('/app/test_reports/bug69_regression_api_results.json')

def req(method,path,token=None,**kw):
    h=kw.pop('headers',{})
    if token: h['Authorization']='Bearer '+token
    r=requests.request(method,API+path,headers=h,timeout=20,**kw)
    try: data=r.json()
    except Exception: data=r.text
    if r.status_code>=400: raise RuntimeError(f'{method} {path} -> {r.status_code}: {data}')
    return data
login=req('POST','/auth/login',json={'username':'serkan','password':'19071987'})
token=login['token']
prefix='BUG69_REG_'+uuid.uuid4().hex[:8]
created=req('POST','/tasks',token,json={'title':prefix+'_CREATE','description':'bug69 regression','due_date':'2026-08-01T09:30:00.000Z'})
status_done=req('PATCH',f"/tasks/{created['id']}",token,json={'status':'done'})
status_pending=req('PATCH',f"/tasks/{created['id']}",token,json={'status':'pending'})
reminder=req('PATCH',f"/tasks/{created['id']}",token,json={'reminder_at':'2026-08-01T10:00:00.000Z','reminder_fired':False})
edited=req('PATCH',f"/tasks/{created['id']}",token,json={'title':prefix+'_EDITED'})
final=req('GET',f"/tasks/{created['id']}",token)
result={
 'base':BASE,
 'task_id':created['id'],
 'create_ok':created['title']==prefix+'_CREATE',
 'status_done_ok':status_done['status']=='done',
 'status_pending_ok':status_pending['status']=='pending',
 'reminder_ok':bool(reminder.get('reminder_at')) and not reminder.get('reminder_fired'),
 'edit_ok':edited['title']==prefix+'_EDITED' and final['title']==prefix+'_EDITED',
 'final':final,
}
result['all_ok']=all(result[k] for k in ['create_ok','status_done_ok','status_pending_ok','reminder_ok','edit_ok'])
OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(OUT.read_text())
