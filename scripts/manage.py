"""Portable setup/start helpers. No machine-specific paths are required."""
import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import urllib.request
import webbrowser

ROOT=Path(__file__).resolve().parent.parent
os.chdir(ROOT)
VENV=ROOT/'.venv'
PY=VENV/('Scripts/python.exe' if os.name=='nt' else 'bin/python')


def run(args,env=None):
    subprocess.run([str(a) for a in args],check=True,env=env)


def runtime():
    """Use normal installations; accept Codex's bundled tools on this machine."""
    env=dict(os.environ)
    base=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies'
    if not shutil.which('node') and (base/'node/bin/node').exists():
        env['PATH']=str(base/'node/bin')+os.pathsep+env.get('PATH','')
    pnpm=shutil.which('pnpm',path=env['PATH'])
    if not pnpm and (base/'bin/fallback/pnpm').exists():pnpm=str(base/'bin/fallback/pnpm')
    return env,pnpm


def setup(with_demo=False):
    if sys.version_info<(3,12):raise SystemExit('Install Python 3.12 or newer, then rerun setup.')
    env,pnpm=runtime()
    if not shutil.which('node',path=env['PATH']) or not pnpm:
        raise SystemExit('Install Node.js 22.12+ and pnpm 11, then rerun setup. See README.md.')
    if not PY.exists():run([sys.executable,'-m','venv',VENV])
    run([PY,'-m','pip','install','-r','requirements.txt'])
    run([pnpm,'install','--frozen-lockfile'],env)
    run([pnpm,'build'],env)
    if not (ROOT/'.env').exists():shutil.copy(ROOT/'.env.example',ROOT/'.env')
    try:(ROOT/'.env').chmod(0o600)
    except OSError:pass
    if with_demo:demo()
    print('\nSetup complete. Run python3 scripts/manage.py start.\nModel downloads: python3 scripts/manage.py models')


def demo():
    """Install the bundled recording workspace without replacing existing data."""
    sys.path.insert(0,str(ROOT))
    from backend.store import data_dir
    source=ROOT/'demo/asklocal.sqlite3'
    if not source.exists():raise SystemExit('The bundled demo database is missing.')
    target=data_dir()/'asklocal.sqlite3'
    target.parent.mkdir(parents=True,exist_ok=True)
    try:
        with target.open('xb') as dest,source.open('rb') as src:
            shutil.copyfileobj(src,dest)
    except FileExistsError:
        print('Existing workspace kept unchanged. Demo accounts were not installed.')
        return False
    try:target.chmod(0o600)
    except OSError:pass
    print('Recording demo installed. Sign in with admin@demo.test or amy@demo.test; password: demo-only-123')
    return True


def start(no_browser=False,port=8000):
    if not PY.exists() or not (ROOT/'dist/index.html').exists():raise SystemExit('Run setup first.')
    if not 1<=port<=65535:raise SystemExit('Choose a port between 1 and 65535.')
    if not no_browser:
        import threading
        threading.Timer(2,lambda:webbrowser.open(f'http://127.0.0.1:{port}')).start()
    run([PY,'-m','uvicorn','backend.main:app','--host','127.0.0.1','--port',str(port)],dict(os.environ,ASKLOCAL_PORT=str(port)))


def doctor():
    env,pnpm=runtime()
    print('Python:',sys.version.split()[0])
    print('Node:',shutil.which('node',path=env['PATH']) or 'MISSING')
    print('pnpm:',pnpm or 'MISSING')
    print('Environment:', 'Ready' if PY.exists() else 'Run setup')
    print('Frontend:', 'Built' if (ROOT/'dist/index.html').exists() else 'Run setup')
    c=sqlite3.connect(':memory:')
    try:c.execute('CREATE VIRTUAL TABLE check_fts USING fts5(text)');print('SQLite keyword search: Available')
    except sqlite3.Error:print('SQLite FTS5: Unavailable; use a supported Python distribution')
    try:
        with urllib.request.urlopen('http://127.0.0.1:11434/api/tags',timeout=3) as r:
            names=[m['name'] for m in json.load(r)['models']]
        print('Ollama: Connected\nDownloaded models:',', '.join(names))
    except Exception:print('Ollama: Start the Ollama application')


def backup(destination):
    sys.path.insert(0,str(ROOT))
    from backend.store import data_dir
    source=data_dir()/'asklocal.sqlite3'
    if not source.exists():raise SystemExit('There is no workspace database yet.')
    target=Path(destination).expanduser().resolve()
    if target.exists():raise SystemExit('Choose a new backup filename; existing files are not overwritten.')
    target.parent.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(source) as src,sqlite3.connect(target) as dest:src.backup(dest)
    try:target.chmod(0o600)
    except OSError:pass
    print('Backup created:',target)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='AskLocal project tools')
    parser.add_argument('command',choices=['setup','start','doctor','models','backup','test','demo'])
    parser.add_argument('--demo',action='store_true',help='Install ready-made demo accounts during setup; preserve existing workspaces.')
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--port',type=int,default=8000,help='Local port to use when starting the app.')
    parser.add_argument('--destination')
    args=parser.parse_args()
    try:
        if args.command=='setup':setup(args.demo)
        elif args.command=='demo':demo()
        elif args.command=='start':start(args.no_browser,args.port)
        elif args.command=='doctor':doctor()
        elif args.command=='models':
            if not shutil.which('ollama'):raise SystemExit('Install Ollama from https://ollama.com first.')
            run(['ollama','pull','qwen3.5:4b']);run(['ollama','pull','qwen3-embedding:0.6b'])
        elif args.command=='backup':
            if not args.destination:raise SystemExit('Provide --destination with a new backup filename.')
            backup(args.destination)
        elif args.command=='test':run([PY,'-m','pytest','-q'])
    except subprocess.CalledProcessError as e:raise SystemExit(e.returncode)
