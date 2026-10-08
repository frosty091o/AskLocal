"""Optional real-model check, isolated from the user's workspace. Requires Ollama."""
import os
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))


def main():
    with tempfile.TemporaryDirectory(prefix='asklocal-smoke-') as root:
        os.environ['ASKLOCAL_DATA_DIR']=root
        os.environ['ASKLOCAL_PROVIDER']='local'
        from backend.main import app
        from fastapi.testclient import TestClient
        from backend import store
        with TestClient(app) as c:
            setup=c.post('/api/setup',json={'name':'Smoke Admin','email':'smoke@test.example','password':'smoke-test-password','demo':True})
            setup.raise_for_status();c.headers['x-csrf-token']=setup.json()['csrf']
            for q,route in [('Where is Amy?','knowledge'),('Can we work remotely during an office closure?','company')]:
                started=time.monotonic()
                r=c.post('/api/ask',json={'question':q});r.raise_for_status()
                assert r.json()['route']==route,r.json()
                print(route,round(time.monotonic()-started,2),'seconds:',r.json()['answer'])
            tid=c.post('/api/threads',json={'title':'Office closure remote work','body':'Can staff work remotely during an office closure?'}).json()['id']
            c.post(f'/api/threads/{tid}/replies',json={'body':'During an office closure staff may work remotely with their manager approval.'}).raise_for_status()
            doc=c.post(f'/api/threads/{tid}/approve',json={'body':'During an office closure, staff may work remotely with approval from their manager.'});doc.raise_for_status()
            r=c.post('/api/ask',json={'question':'Can we work remotely during an office closure?'});r.raise_for_status()
            assert r.json()['route']=='knowledge',r.json()
            assert doc.json()['id'] in [s['id'] for s in r.json()['sources']],r.json()
            print('Approval → retrieval:',r.json()['answer'])
            print('Passed. Temporary test workspace removed; your real workspace was unchanged.')


if __name__=='__main__':main()
