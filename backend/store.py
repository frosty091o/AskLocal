"""Local persistence. Runtime data is deliberately outside the source checkout."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
from contextlib import contextmanager


def data_dir():
    if os.getenv('ASKLOCAL_DATA_DIR'):
        return Path(os.environ['ASKLOCAL_DATA_DIR']).expanduser()
    if sys.platform == 'darwin':
        return Path.home() / 'Library/Application Support/AskLocal'
    if sys.platform == 'win32':
        return Path(os.getenv('LOCALAPPDATA', str(Path.home()))) / 'AskLocal'
    return Path(os.getenv('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'asklocal'


@contextmanager
def db():
    root = data_dir()
    root.mkdir(parents=True, exist_ok=True)
    try:
        root.chmod(0o700)
    except OSError:
        pass
    conn = sqlite3.connect(root / 'asklocal.sqlite3', timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init():
    with db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,department TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,audience TEXT NOT NULL,content TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,thread_id INTEGER,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY,document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,content TEXT NOT NULL,location TEXT NOT NULL,embedding TEXT,embedding_model TEXT);
        CREATE VIRTUAL TABLE IF NOT EXISTS chunk_search USING fts5(content,chunk_id UNINDEXED,document_id UNINDEXED);
        CREATE TABLE IF NOT EXISTS threads(id INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL,audience TEXT NOT NULL,author_id INTEGER REFERENCES users(id),status TEXT NOT NULL DEFAULT 'open',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS replies(id INTEGER PRIMARY KEY,thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,author_id INTEGER REFERENCES users(id),body TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),question TEXT NOT NULL,answer TEXT NOT NULL,route TEXT NOT NULL,sources TEXT NOT NULL,provider TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY,chat_id INTEGER REFERENCES chats(id),user_id INTEGER REFERENCES users(id),kind TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(chat_id,user_id));
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user_id INTEGER,event TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_replies_thread ON replies(thread_id);
        CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id,id);
        CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(active,audience);
        PRAGMA user_version=1;
        ''')
        c.execute('PRAGMA optimize')


def allowed(user, audience):
    return user['role'] == 'admin' or audience == 'everyone' or audience == user['department']


def settings():
    values = {'provider': os.getenv('ASKLOCAL_PROVIDER', 'local'),
              'model': os.getenv('ASKLOCAL_MODEL', 'qwen3.5:4b'),
              'embedding_model': os.getenv('ASKLOCAL_EMBED_MODEL', 'qwen3-embedding:0.6b'),
              'openai_model': os.getenv('OPENAI_MODEL', 'gpt-6-luna'), 'web_enabled': False}
    with db() as c:
        for row in c.execute('SELECT * FROM settings'):
            values[row['key']] = json.loads(row['value'])
    return values


def add_document(c, title, category, audience, pages, thread_id=None):
    full = '\n\n'.join(text for _, text in pages)
    doc = c.execute('INSERT INTO documents(title,category,audience,content,thread_id) VALUES(?,?,?,?,?)',
                    (title, category, audience, full, thread_id)).lastrowid
    for location, text in pages:
        words = text.split()
        for start in range(0, len(words), 300):
            passage = ' '.join(words[start:start+360])
            if not passage:
                continue
            chunk = c.execute('INSERT INTO chunks(document_id,content,location) VALUES(?,?,?)', (doc, passage, location)).lastrowid
            c.execute('INSERT INTO chunk_search(content,chunk_id,document_id) VALUES(?,?,?)', (passage, chunk, doc))
    return doc


def password_hash(password):
    salt = os.urandom(16)
    result = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return salt.hex() + ':' + result.hex()


def password_valid(password, saved):
    import hmac
    salt, expected = saved.split(':')
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return hmac.compare_digest(actual, expected)


def seed(c, admin_id):
    members = [('Amy Chen','amy@demo.test','People'), ('Jordan Lee','jordan@demo.test','Operations')]
    for name,email,dept in members:
        c.execute('INSERT INTO users(name,email,password,role,department) VALUES(?,?,?,?,?)',
                  (name,email,password_hash('demo-only-123'),'employee',dept))
    docs = [
        ('Expense claims','Finance','everyone','To claim a work expense, complete the expense form in the Finance folder and attach an itemised receipt. Submit it to your manager within 14 days. Your manager approves the claim before Finance processes reimbursement in the next payroll cycle. Claims above $250 require approval before purchase.'),
        ('Your first week','People','everyone','New employees meet their manager on day one. Complete the welcome checklist, read the handbook and attend the Wednesday 10 am onboarding session in meeting room Banksia. Amy Chen is the People coordinator. Amy works in room 204 on level two, Monday to Thursday. Contact Amy for onboarding and leave questions.'),
        ('IT support and equipment','IT','everyone','For a broken laptop or software issue, create a ticket with IT support in the internal help portal. Include your device name and a description of the problem. For urgent issues call extension 200. Never put passwords in a ticket or discussion. The standard laptop replacement cycle is three years.'),
        ('Office spaces','Operations','everyone','The office has two floors. Meeting room Banksia is on level one beside reception. Room Waratah is on level two. The kitchen and quiet work area are on level one. Book a room through the shared office calendar. Please release unused bookings.'),
        ('Leadership planning — fictional','Management','management','This fictional restricted document is for the management audience only. The demonstration planning budget is $42000 for next quarter. Do not use this sample as a real company record.')]
    for title,category,audience,text in docs:
        add_document(c,title,category,audience,[('Section 1',text)])
    for title,body,kind,author in [
        ('Can we work remotely during an office closure?','The handbook does not explain what happens if the office is closed. Who can confirm the process?','question',admin_id),
        ('How do we book equipment for a community event?','We are supporting a local volunteer workshop. Is there a process for borrowing our projector?','question',admin_id),
        ('Friday lunch at the park','Anyone keen to bring lunch to the park this Friday? Meet at reception at 12:30.','discussion',2),
        ('Welcome to the team, Jordan','Say hello to our new Operations teammate. Share your favourite tip for your first week!','discussion',2),
        ('Community repair afternoon','We are planning a volunteer repair afternoon. Add your ideas or let us know if you would like to help.','discussion',3)]:
        c.execute('INSERT INTO threads(title,body,kind,audience,author_id) VALUES(?,?,?,?,?)', (title,body,kind,'everyone',author))
