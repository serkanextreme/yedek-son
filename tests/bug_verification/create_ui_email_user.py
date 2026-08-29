#!/usr/bin/env python3
import json, uuid, requests
from pathlib import Path
BASE='https://functional-themes.preview.emergentagent.com/api'
admin=requests.post(f'{BASE}/auth/login', json={'username':'serkan','password':'19071987'}, timeout=20)
admin.raise_for_status()
tok=admin.json()['token']
username=f'TEST_ui_email_{uuid.uuid4().hex[:8]}'
password='Passw0rd!'
r=requests.post(f'{BASE}/admin/users', json={'username':username,'password':password,'role':'user','with_license':'trial'}, headers={'Authorization':f'Bearer {tok}'}, timeout=20)
r.raise_for_status()
user=r.json()
out={'username':username,'password':password,'id':user.get('id'),'admin_token':tok}
Path('/app/test_reports/ui_email_user.json').write_text(json.dumps(out), encoding='utf-8')
print(json.dumps({'username':username,'id':user.get('id')}, ensure_ascii=False))
