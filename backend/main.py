import asyncio
from collections import defaultdict,deque
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse
import httpx
from fastapi import FastAPI, Depends, HTTPException, Request, Response, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pypdf import PdfReader
from starlette.middleware.trustedhost import TrustedHostMiddleware
from . import ai,store

ROOT=Path(__file__).resolve().parent.parent
for line in (ROOT/'.env').read_text().splitlines() if (ROOT/'.env').exists() else []:
    if '=' in line and not line.lstrip().startswith('#'):
        key,value=line.split('=',1)
        os.environ.setdefault(key.strip(),value.strip().strip('"').strip("'"))
login_attempts=defaultdict(deque)
index_state={'running':False,'error':None}


@asynccontextmanager
async def lifespan(app):
    store.init()
    yield


app=FastAPI(title='AskLocal',lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware,allowed_hosts=['localhost','127.0.0.1','testserver'])


@app.middleware('http')
async def guard(request,call_next):
    if request.method not in ('GET','HEAD','OPTIONS'):
        origin=request.headers.get('origin')
        if origin and origin not in ('http://127.0.0.1:8000','http://localhost:8000','http://127.0.0.1:5173','http://localhost:5173'):
            return Response('Cross-origin writes are not allowed.',status_code=403)
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Referrer-Policy']='no-referrer'
    response.headers['X-Frame-Options']='DENY'
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    if request.url.path.startswith('/api'):
        response.headers['Cache-Control']='no-store'
    return response


def user(request:Request):
    token=request.cookies.get('asklocal_session','')
    hashed=hashlib.sha256(token.encode()).hexdigest()
    with store.db() as c:
        r=c.execute('SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',(hashed,time.time())).fetchone()
    if not r:
        raise HTTPException(401,'Please sign in.')
    if request.method not in ('GET','HEAD') and not secrets.compare_digest(request.headers.get('x-csrf-token',''),r['csrf']):
        raise HTTPException(403,'Refresh the page and try again.')
    return dict(r)


def admin(u=Depends(user)):
    if u['role']!='admin':
        raise HTTPException(403,'Admin access required.')
    return u


def public_user(u):
    return {k:u[k] for k in ('id','name','email','role','department','csrf') if k in u}


def create_session(c,response,u):
    token=secrets.token_urlsafe(32)
    csrf=secrets.token_urlsafe(24)
    c.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
    c.execute('INSERT INTO sessions VALUES(?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),u['id'],csrf,time.time()+86400*7))
    response.set_cookie('asklocal_session',token,httponly=True,samesite='strict',max_age=86400*7,path='/')
    u=dict(u); u['csrf']=csrf
    return public_user(u)


class Credentials(BaseModel):
    email:str=Field(min_length=3,max_length=200)
    password:str=Field(min_length=1,max_length=200)


class Setup(Credentials):
    name:str=Field(min_length=1,max_length=100)
    demo:bool=True


@app.get('/api/bootstrap')
def bootstrap():
    with store.db() as c:
        ready=bool(c.execute('SELECT 1 FROM users LIMIT 1').fetchone())
    return {'ready':ready,'company':'Company','demo':store.settings().get('demo',False)}


@app.post('/api/setup')
def setup(body:Setup,response:Response):
    if len(body.password)<10:
        raise HTTPException(400,'Use a password of at least 10 characters.')
    with store.db() as c:
        c.execute('BEGIN IMMEDIATE')
        if c.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            raise HTTPException(409,'Workspace already created. Sign in instead.')
        uid=c.execute('INSERT INTO users(name,email,password,role,department) VALUES(?,?,?,?,?)',(body.name.strip(),body.email.lower().strip(),store.password_hash(body.password),'admin','management')).lastrowid
        c.execute('INSERT INTO settings VALUES(?,?)',('demo',json.dumps(body.demo)))
        if body.demo:
            store.seed(c,uid)
        u=c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
        return create_session(c,response,u)


@app.post('/api/login')
def login(body:Credentials,request:Request,response:Response):
    key=request.client.host
    q=login_attempts[key]
    while q and q[0]<time.time()-60:q.popleft()
    if len(q)>=10:raise HTTPException(429,'Too many attempts. Wait one minute.')
    q.append(time.time())
    with store.db() as c:
        u=c.execute('SELECT * FROM users WHERE email=?',(body.email.lower().strip(),)).fetchone()
        if not u or not store.password_valid(body.password,u['password']):raise HTTPException(401,'Email or password is incorrect.')
        q.clear()
        return create_session(c,response,u)


@app.post('/api/logout')
def logout(request:Request,response:Response,u=Depends(user)):
    with store.db() as c:c.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(request.cookies['asklocal_session'].encode()).hexdigest(),))
    response.delete_cookie('asklocal_session')
    return {'ok':True}


@app.get('/api/me')
def me(u=Depends(user)):return public_user(u)


@app.get('/api/dashboard')
def dashboard(u=Depends(user)):
    with store.db() as c:
        threads=[dict(r) for r in c.execute('SELECT t.*,u.name author,(SELECT count(*) FROM replies r WHERE r.thread_id=t.id) reply_count FROM threads t JOIN users u ON u.id=t.author_id ORDER BY t.id DESC') if store.allowed(u,r['audience'])]
        docs=[dict(r) for r in c.execute('SELECT id,title,category,audience,created,thread_id FROM documents WHERE active=1 ORDER BY id DESC') if store.allowed(u,r['audience'])]
        history=[{'id':r['id'],'question':r['question']} for r in c.execute('SELECT id,question FROM chats WHERE user_id=? ORDER BY id DESC LIMIT 12',(u['id'],))]
    return {'threads':threads,'documents':docs,'history':history}


class ThreadBody(BaseModel):
    title:str=Field(min_length=3,max_length=160)
    body:str=Field(min_length=3,max_length=6000)
    kind:str='question'
    audience:str='everyone'


def audience_check(u,audience):
    if audience not in ('everyone','management','People','Operations','IT','Finance'):
        raise HTTPException(400,'Choose a valid audience.')
    if not store.allowed(u,audience):raise HTTPException(403,'You cannot post to that audience.')


@app.post('/api/threads')
def new_thread(body:ThreadBody,u=Depends(user)):
    audience_check(u,body.audience)
    if body.kind not in ('question','discussion'):raise HTTPException(400,'Invalid discussion type.')
    with store.db() as c:
        tid=c.execute('INSERT INTO threads(title,body,kind,audience,author_id) VALUES(?,?,?,?,?)',(body.title.strip(),body.body.strip(),body.kind,body.audience,u['id'])).lastrowid
    return {'id':tid}


def get_thread(c,tid,u):
    t=c.execute('SELECT t.*,u.name author FROM threads t JOIN users u ON u.id=t.author_id WHERE t.id=?',(tid,)).fetchone()
    if not t or not store.allowed(u,t['audience']):raise HTTPException(404,'Discussion unavailable.')
    return dict(t)


@app.get('/api/threads/{tid}')
def thread(tid:int,u=Depends(user)):
    with store.db() as c:
        t=get_thread(c,tid,u)
        t['replies']=[dict(r) for r in c.execute('SELECT r.*,u.name author FROM replies r JOIN users u ON u.id=r.author_id WHERE thread_id=? ORDER BY r.id',(tid,))]
        approved=c.execute('SELECT id,content FROM documents WHERE thread_id=? AND active=1 ORDER BY id DESC LIMIT 1',(tid,)).fetchone()
        t['approved']=dict(approved) if approved else None
    return t


class TextBody(BaseModel):
    body:str=Field(min_length=2,max_length=6000)


@app.post('/api/threads/{tid}/replies')
def reply(tid:int,body:TextBody,u=Depends(user)):
    with store.db() as c:
        get_thread(c,tid,u)
        c.execute('INSERT INTO replies(thread_id,author_id,body) VALUES(?,?,?)',(tid,u['id'],body.body.strip()))
    return {'ok':True}


@app.post('/api/threads/{tid}/approve')
def approve(tid:int,body:TextBody,u=Depends(admin)):
    with store.db() as c:
        t=get_thread(c,tid,u)
        c.execute('UPDATE documents SET active=0 WHERE thread_id=?',(tid,))
        doc=store.add_document(c,t['title'],'Approved discussion',t['audience'],[('Confirmed answer',body.body.strip())],tid)
        c.execute('UPDATE threads SET status=? WHERE id=?',('approved',tid))
        c.execute('INSERT INTO audit(user_id,event) VALUES(?,?)',(u['id'],f'Approved thread {tid} as document {doc}'))
    return {'id':doc}


@app.get('/api/documents/{did}')
def document(did:int,u=Depends(user)):
    with store.db() as c:
        d=c.execute('SELECT * FROM documents WHERE id=? AND active=1',(did,)).fetchone()
        if not d or not store.allowed(u,d['audience']):raise HTTPException(404,'Document unavailable.')
        result=dict(d)
        result['passages']=[{'id':r['id'],'location':r['location'],'content':r['content']} for r in c.execute('SELECT * FROM chunks WHERE document_id=?',(did,))]
    return result


@app.delete('/api/documents/{did}')
def remove_document(did:int,u=Depends(admin)):
    with store.db() as c:
        d=c.execute('SELECT thread_id FROM documents WHERE id=? AND active=1',(did,)).fetchone()
        if not d:raise HTTPException(404,'Document unavailable.')
        c.execute('UPDATE documents SET active=0 WHERE id=?',(did,))
        if d['thread_id']:c.execute("UPDATE threads SET status='open' WHERE id=?",(d['thread_id'],))
        c.execute('INSERT INTO audit(user_id,event) VALUES(?,?)',(u['id'],f'Withdrew document {did}'))
    return {'ok':True}


@app.post('/api/documents')
async def upload(file:UploadFile=File(...),title:str=Form(...),audience:str=Form('everyone'),u=Depends(admin)):
    audience_check(u,audience)
    if not title.strip() or len(title)>160:raise HTTPException(400,'Enter a title under 160 characters.')
    payload=await file.read(10*1024*1024+1)
    if len(payload)>10*1024*1024:raise HTTPException(413,'Files must be under 10 MB.')
    suffix=Path(file.filename or '').suffix.lower()
    try:
        if suffix=='.pdf':
            reader=PdfReader(io.BytesIO(payload))
            if len(reader.pages)>300:raise ValueError('PDFs must have fewer than 300 pages.')
            pages=[(f'Page {i+1}',p.extract_text() or '') for i,p in enumerate(reader.pages)]
        elif suffix in ('.txt','.md'):
            pages=[('Document text',payload.decode('utf-8'))]
        else:raise ValueError('Use a text PDF, .txt or .md file.')
        if not any(text.strip() for _,text in pages):raise ValueError('No readable text. Scanned PDFs need OCR first.')
        if sum(len(t) for _,t in pages)>600000:raise ValueError('Document text is too large for this prototype.')
    except Exception as e:raise HTTPException(400,str(e)[:200])
    with store.db() as c:
        did=store.add_document(c,title.strip(),'Company document',audience,pages)
        c.execute('INSERT INTO audit(user_id,event) VALUES(?,?)',(u['id'],f'Uploaded document {did}'))
    return {'id':did}


class Question(BaseModel):
    question:str=Field(min_length=3,max_length=2000)


@app.post('/api/ask')
async def ask(body:Question,u=Depends(user)):
    try:
        result=await ai.answer(body.question,u)
    except (httpx.HTTPError,ValueError,KeyError,TypeError):
        raise HTTPException(503,'AI is unavailable or returned an unreadable answer. Check Settings for your selected model or API key, then retry. No cloud fallback was used.')
    with store.db() as c:
        # Recheck every source immediately before saving a result.
        for source in result['sources']:
            d=c.execute('SELECT active,audience FROM documents WHERE id=?',(source['id'],)).fetchone()
            if not d or not d['active'] or not store.allowed(u,d['audience']):raise HTTPException(409,'Sources changed while answering. Please ask again.')
        cid=c.execute('INSERT INTO chats(user_id,question,answer,route,sources,provider) VALUES(?,?,?,?,?,?)',(u['id'],body.question,result['answer'],result['route'],json.dumps(result['sources']),result['provider'])).lastrowid
    return {**result,'id':cid,'question':body.question}


@app.get('/api/chats/{cid}')
def chat(cid:int,u=Depends(user)):
    with store.db() as c:
        r=c.execute('SELECT * FROM chats WHERE id=? AND user_id=?',(cid,u['id'])).fetchone()
        if not r:raise HTTPException(404,'Conversation unavailable.')
        result=dict(r);result['sources']=json.loads(r['sources'])
        for source in result['sources']:
            if 'id' not in source:continue
            d=c.execute('SELECT active,audience FROM documents WHERE id=?',(source['id'],)).fetchone()
            if not d or not d['active'] or not store.allowed(u,d['audience']):
                result.update(answer='The source information has changed or is no longer accessible. Ask again for a current answer.',sources=[],route='stale')
                break
    return result


class GeneralQuestion(Question):
    acknowledge_cloud:bool=False
    use_chatgpt:bool=False


@app.post('/api/general')
async def general(body:GeneralQuestion,u=Depends(user)):
    cfg=store.settings()
    if body.use_chatgpt:
        if not os.getenv('OPENAI_API_KEY'):raise HTTPException(400,'Add an OpenAI API key in Settings before using ChatGPT.')
        if not body.acknowledge_cloud:raise HTTPException(400,'Confirm this question is safe to send to ChatGPT.')
        try:
            # This explicit general-purpose request contains only the edited question,
            # never retrieved company passages, documents, or private chat history.
            answer,_=await ai.cloud_generate([{'role':'system','content':'Give a brief general-information answer. You have no company records. Do not claim to know internal company policies or private facts. If the question requires company-specific information, say you cannot answer it.'},{'role':'user','content':body.question}],cfg)
            sources=[];route='general_answer';provider='openai'
        except (httpx.HTTPError,ValueError,KeyError):raise HTTPException(503,'Could not generate a ChatGPT answer. Check your API key and settings.')
    else:
        use_cloud=cfg['web_enabled'] or cfg['provider']=='openai'
        if use_cloud and not body.acknowledge_cloud:raise HTTPException(400,'Confirm this is a public question before sending it online.')
        try:
            # No company evidence or private history is included in this separate request.
            if cfg['web_enabled']:
                answer,citations=await ai.cloud_generate([{'role':'user','content':body.question}],cfg,web=True)
                sources=[]
                for s in citations:
                    if urlparse(s.get('url','')).scheme in ('https','http'):
                        source={'url':s['url'],'title':s.get('title',s['url'])}
                        if source not in sources:sources.append(source)
                if not sources:raise ValueError('Web answer missing sources.')
                route='web';provider='openai'
            else:
                answer=await ai.generate([{'role':'system','content':'Give a brief general-information answer. You have no company records or live web access. Do not claim to know internal company policies or current live facts.'},{'role':'user','content':body.question}],cfg)
                sources=[];route='general_answer';provider=cfg['provider']
        except (httpx.HTTPError,ValueError,KeyError):raise HTTPException(503,'Could not generate a general answer. Check your provider settings.')
    with store.db() as c:
        cid=c.execute('INSERT INTO chats(user_id,question,answer,route,sources,provider) VALUES(?,?,?,?,?,?)',(u['id'],body.question,answer,route,json.dumps(sources),provider)).lastrowid
    return {'id':cid,'question':body.question,'answer':answer,'route':route,'sources':sources,'provider':provider}


class Feedback(BaseModel):
    kind:str


@app.post('/api/chats/{cid}/feedback')
def feedback(cid:int,body:Feedback,u=Depends(user)):
    if body.kind not in ('helpful','incorrect','outdated'):raise HTTPException(400,'Invalid feedback.')
    with store.db() as c:
        if not c.execute('SELECT 1 FROM chats WHERE id=? AND user_id=?',(cid,u['id'])).fetchone():raise HTTPException(404,'Answer unavailable.')
        c.execute('INSERT INTO feedback(chat_id,user_id,kind) VALUES(?,?,?) ON CONFLICT(chat_id,user_id) DO UPDATE SET kind=excluded.kind,resolved=0',(cid,u['id'],body.kind))
    return {'ok':True}


@app.get('/api/settings')
async def get_settings(u=Depends(user)):
    cfg=store.settings()
    with store.db() as c:
        count=c.execute('SELECT count(*) FROM chunks ch JOIN documents d ON d.id=ch.document_id WHERE d.active=1 AND ch.embedding_model=?',(cfg['embedding_model'],)).fetchone()[0]
        total=c.execute('SELECT count(*) FROM chunks ch JOIN documents d ON d.id=ch.document_id WHERE d.active=1').fetchone()[0]
    models=[];connected=False
    try:
        async with httpx.AsyncClient(timeout=3,trust_env=False) as client:
            r=await client.get(ai.OLLAMA+'/api/tags');r.raise_for_status()
            models=[m['name'] for m in r.json().get('models',[])];connected=True
    except httpx.HTTPError:pass
    return {**cfg,'api_key_set':bool(os.getenv('OPENAI_API_KEY')),'ollama_connected':connected,'models':models,'indexed':count,'total':total,'index':index_state}


class Config(BaseModel):
    provider:str
    model:str=Field(min_length=1,max_length=100)
    embedding_model:str=Field(min_length=1,max_length=100)
    openai_model:str=Field(min_length=1,max_length=100)
    web_enabled:bool


@app.put('/api/settings')
def save_settings(body:Config,u=Depends(admin)):
    if body.provider not in ('local','openai'):raise HTTPException(400,'Invalid provider.')
    if ':cloud' in body.model.lower() or ':cloud' in body.embedding_model.lower():raise HTTPException(400,'Use downloaded local Ollama models.')
    if (body.provider=='openai' or body.web_enabled) and not os.getenv('OPENAI_API_KEY'):raise HTTPException(400,'Add OPENAI_API_KEY to .env and restart first.')
    with store.db() as c:
        for k,v in body.model_dump().items():c.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(k,json.dumps(v)))
    return {'ok':True}


async def reindex_task():
    try:await ai.index_documents()
    except Exception:index_state['error']='Embedding model unavailable. Start Ollama, download the configured embedding model and retry.'
    finally:index_state['running']=False


@app.post('/api/reindex')
async def reindex(u=Depends(admin)):
    if index_state['running']:raise HTTPException(409,'Indexing is already running.')
    index_state.update(running=True,error=None)
    asyncio.create_task(reindex_task())
    return {'ok':True}


@app.get('/api/admin')
def admin_info(u=Depends(admin)):
    with store.db() as c:
        members=[dict(r) for r in c.execute('SELECT id,name,email,role,department FROM users')]
        reports=[dict(r) for r in c.execute("SELECT f.id,f.kind,f.created,ch.question,u.name author FROM feedback f JOIN chats ch ON ch.id=f.chat_id JOIN users u ON u.id=f.user_id WHERE f.resolved=0 AND f.kind!='helpful' ORDER BY f.id DESC")]
        audit=[dict(r) for r in c.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 20')]
    return {'members':members,'reports':reports,'audit':audit}


@app.post('/api/feedback/{fid}/resolve')
def resolve(fid:int,u=Depends(admin)):
    with store.db() as c:c.execute('UPDATE feedback SET resolved=1 WHERE id=?',(fid,))
    return {'ok':True}


class Member(Setup):
    role:str='employee'
    department:str='Operations'


@app.post('/api/members')
def add_member(body:Member,u=Depends(admin)):
    if body.role not in ('admin','employee') or body.department not in ('People','Operations','IT','Finance','management'):raise HTTPException(400,'Invalid role or department.')
    if len(body.password)<10:raise HTTPException(400,'Password must have at least 10 characters.')
    with store.db() as c:
        if c.execute('SELECT 1 FROM users WHERE email=?',(body.email.lower().strip(),)).fetchone():raise HTTPException(409,'That email already exists.')
        c.execute('INSERT INTO users(name,email,password,role,department) VALUES(?,?,?,?,?)',(body.name,body.email.lower().strip(),store.password_hash(body.password),body.role,body.department))
    return {'ok':True}


@app.get('/api/health')
def health():return {'status':'ok'}


if (ROOT/'dist').exists():
    app.mount('/assets',StaticFiles(directory=ROOT/'dist/assets'),name='assets')
    @app.get('/favicon.svg')
    def favicon():return FileResponse(ROOT/'dist/favicon.svg')
    @app.get('/')
    def home():return FileResponse(ROOT/'dist/index.html')
