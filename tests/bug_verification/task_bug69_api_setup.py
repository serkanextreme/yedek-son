
#!/usr/bin/env python3
"""Seed and API-verify task reorder/archive persistence for bug verification iteration 69."""
import json, os, time, uuid, requests
from pathlib import Path

BASE = os.environ.get('SERTEST_BASE', 'https://functional-themes.preview.emergentagent.com').rstrip('/')
API = BASE + '/api'
OUT = Path('/app/test_reports/task_bug69_api_setup_output.json')
PREFIX = 'BUG69_UI_' + uuid.uuid4().hex[:8]

def req(method, path, token=None, **kwargs):
    headers = kwargs.pop('headers', {})
    if token:
        headers['Authorization'] = f'Bearer {token}'
    r = requests.request(method, API + path, headers=headers, timeout=20, **kwargs)
    try:
        data = r.json()
    except Exception:
        data = r.text
    if r.status_code >= 400:
        raise RuntimeError(f'{method} {path} -> {r.status_code}: {data}')
    return data

login = req('POST', '/auth/login', json={'username':'serkan','password':'19071987'})
token = login['token']
user = login['user']
# Try to get usable company id for optional category creation.
me = req('GET', '/auth/me', token=token)
company_id = me.get('company_id') or (me.get('company_ids') or [None])[0]
cat = None
try:
    cats = req('GET', '/task-categories', token=token, params={'scope':'my_tasks'})
    if cats:
        cat = cats[0]
except Exception as e:
    cats = []
# If none are visible, create one for admin if a company is available.
if not cat and company_id:
    try:
        cat = req('POST', '/task-categories', token=token, json={'name': PREFIX + '_CAT', 'company_id': company_id, 'color':'#00f0ff'})
    except Exception as e:
        cat = {'error': str(e)}

# Create 4 active tasks; first 3 category-tagged if a category exists for filtered reorder.
created = []
for i in range(1,5):
    body = {'title': f'{PREFIX}_TASK_{i}', 'description': 'bug69 dnd/archive verification'}
    if cat and cat.get('id') and i <= 3:
        body['category_id'] = cat['id']
    created.append(req('POST', '/tasks', token=token, json=body))
    time.sleep(0.05)
ids_created = [t['id'] for t in created]
# Put seeded tasks at the top in natural order 1,2,3,4 plus preserve rest after.
active = req('GET', '/tasks', token=token, params={'archived':'false'})
rest = [t['id'] for t in active if t['id'] not in ids_created]
req('POST', '/tasks/reorder', token=token, json={'ids': ids_created + rest})
active_after = req('GET', '/tasks', token=token, params={'archived':'false'})
seed_top = [(t['id'], t['title'], t.get('sort_order'), t.get('category_id')) for t in active_after if t['id'] in ids_created]
# API persistence check: move task 3 to top among all visible active tasks.
order1 = [ids_created[2], ids_created[0], ids_created[1], ids_created[3]] + rest
req('POST', '/tasks/reorder', token=token, json={'ids': order1})
check1 = req('GET', '/tasks', token=token, params={'archived':'false'})
api_reorder_top4 = [t['id'] for t in check1 if t['id'] in ids_created][:4]
# Restore seed order for UI drag test.
req('POST', '/tasks/reorder', token=token, json={'ids': ids_created + rest})

OUT.write_text(json.dumps({
    'base': BASE,
    'prefix': PREFIX,
    'token': token,
    'user_id': user.get('id'),
    'company_id': company_id,
    'category': cat,
    'created': created,
    'ids_created': ids_created,
    'seed_top': seed_top,
    'api_reorder_top4': api_reorder_top4,
    'api_reorder_expected_top4': order1[:4],
    'api_reorder_ok': api_reorder_top4 == order1[:4],
}, ensure_ascii=False, indent=2))
print(OUT.read_text())
