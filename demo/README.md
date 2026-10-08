# Ready-to-record demo

This database is generated from fictional sample data. It includes three accounts, five company documents, five boards and one reply awaiting admin confirmation. It contains no saved chats, login sessions or API keys.

## Install

After installing the prerequisites in the main README:

macOS/Linux:

```sh
sh setup.sh --demo
python3 scripts/manage.py models
sh start.sh
```

Windows:

```powershell
py -3 scripts/manage.py setup --demo
py -3 scripts/manage.py models
py -3 scripts/manage.py start
```

If dependencies are already installed, use `python3 scripts/manage.py demo` (Windows: `py -3 scripts/manage.py demo`). Existing databases are kept unchanged. Use a separate `ASKLOCAL_DATA_DIR` if you want a fresh recording workspace on a computer that already has AskLocal data.

## Accounts

All three use **demo-only-123**:

| Account | Role |
| --- | --- |
| admin@demo.test | Admin |
| amy@demo.test | Employee, People |
| jordan@demo.test | Employee, Operations |

## Recording flow

1. Sign in as Amy and ask **Where is Amy?** or **How do I claim an expense?**. Show the answer and its company source.
2. Ask **Can we work remotely during an office closure?**. Show the missing-knowledge options and discussion board.
3. Open **How do we book equipment for a community event?**. It has a suggested reply ready for the admin to review.
4. Sign in as admin, confirm an answer, then ask the question again to show it becoming reusable knowledge.
5. Show that the fictional leadership document is restricted to the admin.

Keyword retrieval is ready immediately. For semantic retrieval, click **Build semantic index** in Settings after downloading the models. OpenAI demonstrations require your own API key and API credit; the bundled database uses local mode.

Regenerate the clean bundle with `python3 scripts/build_demo.py`. Do not replace it with a copy of a real workspace.
