import asyncio
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend import ai,store


@pytest.fixture
def workspace(tmp_path,monkeypatch):
    monkeypatch.setenv('ASKLOCAL_DATA_DIR',str(tmp_path))
    with TestClient(app) as c:
        r=c.post('/api/setup',json={'name':'Test Admin','email':'admin@test.example','password':'test-password-123','demo':True})
        assert r.status_code==200,r.text
        c.headers['x-csrf-token']=r.json()['csrf']
        yield c


def employee(c):
    r=c.post('/api/login',json={'email':'amy@demo.test','password':'demo-only-123'})
    assert r.status_code==200
    c.headers['x-csrf-token']=r.json()['csrf']


def test_permissions_and_csrf(workspace):
    c=workspace
    restricted=next(d for d in c.get('/api/dashboard').json()['documents'] if d['audience']=='management')
    employee(c)
    assert restricted['id'] not in [d['id'] for d in c.get('/api/dashboard').json()['documents']]
    assert c.get(f"/api/documents/{restricted['id']}").status_code==404
    assert c.get('/api/admin').status_code==403
    assert c.post('/api/threads',json={'title':'Private plan','body':'Question','audience':'management'}).status_code==403
    c.headers.pop('x-csrf-token')
    assert c.post('/api/threads',json={'title':'CSRF attack','body':'Test'}).status_code==403
    assert c.post('/api/login',json={'email':'amy@demo.test','password':'demo-only-123'},headers={'Origin':'https://attacker.example'}).status_code==403


def test_discussion_approval_withdrawal_and_history(workspace,monkeypatch):
    c=workspace
    tid=c.post('/api/threads',json={'title':'Office closure process','body':'What is our remote work process during a closure?'}).json()['id']
    assert c.post(f'/api/threads/{tid}/replies',json={'body':'Staff can work from home with manager approval.'}).status_code==200
    with store.db() as db:
        assert not db.execute('SELECT 1 FROM documents WHERE thread_id=?',(tid,)).fetchone()
    employee(c)
    assert c.post(f'/api/threads/{tid}/approve',json={'body':'Unreviewed claim'}).status_code==403
    r=c.post('/api/login',json={'email':'admin@test.example','password':'test-password-123'});c.headers['x-csrf-token']=r.json()['csrf']
    approval=c.post(f'/api/threads/{tid}/approve',json={'body':'During an office closure, staff work from home with manager approval.'})
    assert approval.status_code==200
    did=approval.json()['id']
    async def generate(messages,cfg,schema=None):
        evidence=json.loads(messages[-1]['content'])['evidence']
        item=next(x for x in evidence if x['title']=='Office closure process')
        return json.dumps({'supported':True,'answer':'Staff work from home with manager approval.','source_ids':[item['id']]})
    monkeypatch.setattr(ai,'generate',generate)
    r=c.post('/api/ask',json={'question':'What is the office closure remote work process?'})
    assert r.status_code==200,r.text
    assert r.json()['route']=='knowledge'
    cid=r.json()['id']
    assert r.json()['sources'][0]['id']==did
    assert c.delete(f'/api/documents/{did}').status_code==200
    assert c.get(f'/api/chats/{cid}').json()['route']=='stale'
    assert c.get(f'/api/chats/{cid}').json()['sources']==[]
    assert c.get(f'/api/threads/{tid}').json()['status']=='open'


def test_upload_and_persistence(workspace):
    c=workspace
    r=c.post('/api/documents',data={'title':'Volunteer equipment','audience':'everyone'},files={'file':('guide.md',b'Book the projector through the Operations coordinator.','text/markdown')})
    assert r.status_code==200,r.text
    did=r.json()['id']
    assert 'projector' in c.get(f'/api/documents/{did}').json()['content']
    store.init()
    assert c.get(f'/api/documents/{did}').status_code==200
    assert c.post('/api/documents',data={'title':'Bad'},files={'file':('file.exe',b'123')}).status_code==400
    assert c.post('/api/setup',json={'name':'Second','email':'two@test.example','password':'second-password','demo':False}).status_code==409


def test_no_cloud_fallback_and_missing_context(workspace,monkeypatch):
    c=workspace
    cloud_calls=[]
    async def cloud(*args,**kwargs):cloud_calls.append(1);raise AssertionError('No cloud calls permitted')
    async def local(messages,model,schema=None):
        if schema and 'supported' in schema['properties']:
            return json.dumps({'supported':False,'answer':'','source_ids':[]})
        return json.dumps({'route':'company','clarification':''})
    monkeypatch.setattr(ai,'cloud_generate',cloud)
    monkeypatch.setattr(ai,'local_generate',local)
    r=c.post('/api/ask',json={'question':'What is the internal office closure policy?'})
    assert r.status_code==200,r.text
    assert r.json()['route']=='company'
    assert not cloud_calls
    async def failed(*args,**kwargs):raise ValueError('Disconnected')
    monkeypatch.setattr(ai,'local_generate',failed)
    assert c.post('/api/ask',json={'question':'What is the office policy?'}).status_code==503
    assert not cloud_calls


def test_chatgpt_general_is_explicit_and_sends_only_edited_question(workspace,monkeypatch):
    c=workspace
    monkeypatch.setenv('OPENAI_API_KEY','test-key')
    sent=[]
    async def cloud(messages,cfg,schema=None,web=False):
        sent.append((messages,cfg,web))
        return 'A general answer.',[]
    monkeypatch.setattr(ai,'cloud_generate',cloud)
    assert c.post('/api/general',json={'question':'Can the company approve this?','use_chatgpt':True}).status_code==400
    r=c.post('/api/general',json={'question':'What are common options?','use_chatgpt':True,'acknowledge_cloud':True})
    assert r.status_code==200,r.text
    assert r.json()['provider']=='openai'
    assert sent[0][0][-1]=={'role':'user','content':'What are common options?'}
    assert not sent[0][2]
def test_retrieval_filters_private_chunks(workspace):
    with store.db() as db:
        u=dict(db.execute("SELECT * FROM users WHERE email='amy@demo.test'").fetchone())
    passages,_=asyncio.run(ai.retrieve('Leadership planning budget next quarter',u))
    assert all(p['audience']!='management' for p in passages)


def test_private_history_and_feedback(workspace):
    c=workspace
    with store.db() as db:
        cid=db.execute('INSERT INTO chats(user_id,question,answer,route,sources,provider) VALUES(1,?,?,?,?,?)',('Private question','Answer','company','[]','local')).lastrowid
    assert c.post(f'/api/chats/{cid}/feedback',json={'kind':'incorrect'}).status_code==200
    employee(c)
    assert c.get(f'/api/chats/{cid}').status_code==404
    assert c.post(f'/api/chats/{cid}/feedback',json={'kind':'incorrect'}).status_code==404
