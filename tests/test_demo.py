import json
import sqlite3
from fastapi.testclient import TestClient
from backend.main import app
from backend import store
from scripts import manage


def test_bundled_database_contains_only_recording_data():
    source=manage.ROOT/'demo/asklocal.sqlite3'
    with sqlite3.connect(f'{source.as_uri()}?mode=ro',uri=True) as c:
        assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
        accounts=c.execute('SELECT email,password FROM users').fetchall()
        assert {email for email,_ in accounts}=={'admin@demo.test','amy@demo.test','jordan@demo.test'}
        assert all(store.password_valid('demo-only-123',password) for _,password in accounts)
        for table in ['sessions','chats','feedback','audit']:
            assert c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==0
        settings={key:json.loads(value) for key,value in c.execute('SELECT key,value FROM settings')}
        assert settings=={'demo':True,'provider':'local','web_enabled':False}
        assert c.execute('SELECT COUNT(*) FROM documents').fetchone()[0]==5
        assert c.execute('SELECT COUNT(*) FROM chunk_search').fetchone()[0]==5


def test_demo_install_skips_setup_and_all_accounts_can_login(tmp_path,monkeypatch):
    monkeypatch.setenv('ASKLOCAL_DATA_DIR',str(tmp_path))
    assert manage.demo()
    with TestClient(app) as client:
        assert client.get('/api/bootstrap').json()['ready']
        for email in ['admin@demo.test','amy@demo.test','jordan@demo.test']:
            r=client.post('/api/login',json={'email':email,'password':'demo-only-123'})
            assert r.status_code==200,r.text
            docs=client.get('/api/dashboard').json()['documents']
            assert bool([d for d in docs if d['audience']=='management'])==(email=='admin@demo.test')
        with store.db() as c:
            assert c.execute("SELECT COUNT(*) FROM replies JOIN threads ON threads.id=replies.thread_id WHERE threads.title='How do we book equipment for a community event?'").fetchone()[0]==1


def test_demo_install_never_replaces_an_existing_workspace(tmp_path,monkeypatch):
    monkeypatch.setenv('ASKLOCAL_DATA_DIR',str(tmp_path))
    target=tmp_path/'asklocal.sqlite3'
    original=b'existing workspace must stay unchanged'
    target.write_bytes(original)
    assert not manage.demo()
    assert target.read_bytes()==original
