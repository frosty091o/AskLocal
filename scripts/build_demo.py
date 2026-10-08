"""Build the shareable fictional recording database, never the live workspace."""
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from backend import store


def build():
    target=ROOT/'demo/asklocal.sqlite3'
    target.parent.mkdir(parents=True,exist_ok=True)
    previous=os.environ.get('ASKLOCAL_DATA_DIR')
    try:
        with tempfile.TemporaryDirectory(prefix='asklocal-demo-') as directory:
            os.environ['ASKLOCAL_DATA_DIR']=directory
            store.init()
            with store.db() as c:
                admin=c.execute('INSERT INTO users(name,email,password,role,department) VALUES(?,?,?,?,?)',
                    ('Demo Admin','admin@demo.test',store.password_hash('demo-only-123'),'admin','management')).lastrowid
                store.seed(c,admin)
                for key,value in {'demo':True,'provider':'local','web_enabled':False}.items():
                    c.execute('INSERT INTO settings VALUES(?,?)',(key,json.dumps(value)))
                thread=c.execute("SELECT id FROM threads WHERE title='How do we book equipment for a community event?'").fetchone()[0]
                jordan=c.execute("SELECT id FROM users WHERE email='jordan@demo.test'").fetchone()[0]
                c.execute('INSERT INTO replies(thread_id,author_id,body) VALUES(?,?,?)',
                    (thread,jordan,'Suggested process for review: ask Operations to confirm availability, book the projector in the shared office calendar, and return it on the next working day.'))
            with sqlite3.connect(Path(directory)/'asklocal.sqlite3') as src,sqlite3.connect(target) as dest:
                src.backup(dest)
                dest.execute('PRAGMA journal_mode=DELETE')
            print('Built fictional recording database:',target)
    finally:
        if previous is None:os.environ.pop('ASKLOCAL_DATA_DIR',None)
        else:os.environ['ASKLOCAL_DATA_DIR']=previous


if __name__=='__main__':build()
