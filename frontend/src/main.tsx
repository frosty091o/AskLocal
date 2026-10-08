import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  MessageSquare,
  Search,
  Plus,
  ShieldCheck,
  Settings,
  LogOut,
  Home,
  CheckCircle2,
  Users,
  FileText,
  X,
  ThumbsUp,
  Flag,
  Upload,
  Lock,
  ChevronDown,
  Menu,
  Loader2,
  Sparkles,
  ExternalLink,
  HelpCircle,
  Database,
  Monitor,
  Globe,
  Clock3,
} from "lucide-react";
import { ChatGPTIcon } from "./ChatGPTIcon";
import "./style.css";

type User = {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  csrf: string;
};
type Thread = {
  id: number;
  title: string;
  body: string;
  kind: string;
  audience: string;
  author: string;
  author_department: string;
  status: string;
  reply_count: number;
  created: string;
  replies?: { id: number; author: string; body: string; created: string }[];
  approved?: { id: number; content: string };
};
type Doc = {
  id: number;
  title: string;
  category: string;
  audience: string;
  created: string;
  content?: string;
  thread_id?: number;
  passages?: { id: number; location: string; content: string }[];
};
type Source = {
  id?: number;
  chunk_id?: number;
  title: string;
  location?: string;
  excerpt?: string;
  url?: string;
};
type Chat = {
  id: number;
  question: string;
  answer: string;
  route: string;
  provider: string;
  sources: Source[];
  retrieval?: string;
  similar_threads?: { id: number; title: string }[];
};
type Dashboard = {
  threads: Thread[];
  documents: Doc[];
  history: { id: number; question: string }[];
};
type Config = {
  provider: string;
  model: string;
  embedding_model: string;
  openai_model: string;
  web_enabled: boolean;
  api_key_set: boolean;
  ollama_connected: boolean;
  models: string[];
  indexed: number;
  total: number;
  index: { running: boolean; error?: string };
};
let csrf = "";
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const r = await fetch("/api" + path, { ...init, headers });
  if (!r.ok) {
    let message = "Something went wrong. Please retry.";
    try {
      const data = await r.json();
      message =
        typeof data.detail === "string"
          ? data.detail
          : "Please check the form fields.";
    } catch {}
    throw new Error(message);
  }
  return r.json();
}
const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const date = (value: string) =>
  new Date(value.replace(" ", "T") + "Z").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
function Badge({
  children,
  kind = "",
}: {
  children: React.ReactNode;
  kind?: string;
}) {
  return <span className={"badge " + kind}>{children}</span>;
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty" role="status">
      <MessageSquare size={26} />
      <p>{text}</p>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
  error = "",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={wide ? "wide" : ""}
      onCancel={onClose}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      <div className="modal-body">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
function AnswerText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
  return (
    <div className="answer-text">
      {parts.map((part, i) => {
        const m = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        return m ? (
          <a key={i} href={m[2]} target="_blank" rel="noopener noreferrer">
            {m[1]}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        );
      })}
    </div>
  );
}

function App() {
  const [boot, setBoot] = useState<{ ready: boolean; demo: boolean } | null>(
      null,
    ),
    [me, setMe] = useState<User | null>(null),
    [page, setPage] = useState("home");
  const [data, setData] = useState<Dashboard>({
      threads: [],
      documents: [],
      history: [],
    }),
    [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false);
  const [question, setQuestion] = useState(""),
    [chat, setChat] = useState<Chat | null>(null),
    [chatgptOpen, setChatgptOpen] = useState(false),
    [chatgptDraft, setChatgptDraft] = useState(""),
    [chatgptConsent, setChatgptConsent] = useState(false),
    [thread, setThread] = useState<Thread | null>(null),
    [document, setDocument] = useState<Doc | null>(null),
    [highlight, setHighlight] = useState<number | undefined>();
  const [newThread, setNewThread] = useState(false),
    [threadDraft, setThreadDraft] = useState(""),
    [upload, setUpload] = useState(false),
    [filter, setFilter] = useState("all"),
    [departmentFilter, setDepartmentFilter] = useState("all"),
    [questionStatus, setQuestionStatus] = useState("all"),
    [librarySearch, setLibrarySearch] = useState("");
  const [adminData, setAdminData] = useState<{
    members: User[];
    reports: { id: number; kind: string; question: string; author: string }[];
    audit: { id: number; event: string; created: string }[];
  } | null>(null);
  const [auth, setAuth] = useState({
      name: "",
      email: "",
      password: "",
      demo: true,
    }),
    [reply, setReply] = useState(""),
    [approved, setApproved] = useState("");
  async function refresh() {
    const d = await api<Dashboard>("/dashboard");
    setData(d);
  }
  async function refreshSettings() {
    const c = await api<Config>("/settings");
    setCfg(c);
  }
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Something went wrong.");
  useEffect(() => {
    (async () => {
      try {
        setBoot(await api("/bootstrap"));
        try {
          const u = await api<User>("/me");
          csrf = u.csrf;
          setMe(u);
        } catch {}
      } catch (e) {
        fail(e);
      }
    })();
  }, []);
  useEffect(() => {
    if (me) {
      refresh().catch(fail);
      refreshSettings().catch(fail);
    }
  }, [me]);
  useEffect(() => {
    if (page === "admin" && me?.role === "admin")
      api<typeof adminData>("/admin").then(setAdminData).catch(fail);
    if (page === "settings" && me) refreshSettings().catch(fail);
  }, [page, me]);
  useEffect(() => {
    if (!cfg?.index.running) return;
    const timer = setInterval(() => refreshSettings().catch(fail), 2000);
    return () => clearInterval(timer);
  }, [cfg?.index.running]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    setChatgptDraft(chat?.question ?? "");
    setChatgptOpen(false);
    setChatgptConsent(false);
  }, [chat?.id]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page, chat?.id]);
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const u = await post<User>(boot?.ready ? "/login" : "/setup", auth);
      csrf = u.csrf;
      setMe(u);
      setMenu(false);
      setBoot(await api("/bootstrap"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function ask(e?: React.FormEvent, q = question) {
    e?.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    setError("");
    setChat(null);
    setPage("assistant");
    try {
      const a = await post<Chat>("/ask", { question: q });
      setChat(a);
      setChatgptDraft(q);
      setChatgptOpen(false);
      setChatgptConsent(false);
      setQuestion("");
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function openThread(id: number) {
    try {
      setThread(await api("/threads/" + id));
      setReply("");
      setApproved("");
    } catch (e) {
      fail(e);
    }
  }
  async function openDocument(id: number, chunk?: number) {
    try {
      setDocument(await api("/documents/" + id));
      setHighlight(chunk);
    } catch (e) {
      fail(e);
    }
  }
  function beginThread(text = "", kind = "question") {
    setError("");
    setThreadDraft(text);
    setNewThread(true);
    setFilter(kind);
  }
  async function createThread(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await post<{ id: number }>("/threads", Object.fromEntries(f));
      setNewThread(false);
      await refresh();
      await openThread(r.id);
      setNotice("Discussion posted.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!thread) return;
    setBusy(true);
    try {
      await post("/threads/" + thread.id + "/replies", { body: reply });
      await openThread(thread.id);
      await refresh();
      setNotice("Reply added.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function approveAnswer(e: React.FormEvent) {
    e.preventDefault();
    if (!thread) return;
    setBusy(true);
    try {
      await post("/threads/" + thread.id + "/approve", { body: approved });
      await openThread(thread.id);
      await refresh();
      setNotice("Approved answer added to company knowledge.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function uploadDocument(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/documents", {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      setUpload(false);
      await refresh();
      await refreshSettings();
      setNotice(
        "Document saved. It is searchable by keyword; build the semantic index in Settings.",
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function feedback(kind: string) {
    if (!chat) return;
    try {
      await post("/chats/" + chat.id + "/feedback", { kind });
      setNotice(
        kind === "helpful"
          ? "Thanks for your feedback."
          : "Report sent to the admin for review.",
      );
    } catch (e) {
      fail(e);
    }
  }
  async function general() {
    if (!chat) return;
    setBusy(true);
    try {
      setChat(
        await post("/general", {
          question: chat.question,
          acknowledge_cloud: !!(cfg?.web_enabled || cfg?.provider === "openai"),
        }),
      );
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function askChatGPT() {
    if (!chat || !chatgptConsent || !chatgptDraft.trim()) return;
    setBusy(true);
    try {
      setChat(
        await post("/general", {
          question: chatgptDraft.trim(),
          use_chatgpt: true,
          acknowledge_cloud: true,
        }),
      );
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function chatgptAction() {
    if (!cfg?.api_key_set) {
      return (
        <p className="helper-text">
          ChatGPT isn’t connected yet. An admin can follow Setup help in
          Settings to add an API key.
        </p>
      );
    }
    return chatgptOpen ? (
      <div className="general-action">
        <label htmlFor="chatgpt-draft">
          Review and edit the question for ChatGPT
        </label>
        <textarea
          id="chatgpt-draft"
          value={chatgptDraft}
          onChange={(e) => setChatgptDraft(e.target.value)}
          rows={3}
        />
        <label className="consent-row">
          <input
            type="checkbox"
            checked={chatgptConsent}
            onChange={(e) => setChatgptConsent(e.target.checked)}
          />
          I checked this text and removed company or personal information. Send
          only this question to ChatGPT.
        </label>
        <button
          className="primary"
          onClick={askChatGPT}
          disabled={busy || !chatgptConsent || !chatgptDraft.trim()}
        >
          <ChatGPTIcon />
          Ask ChatGPT
        </button>
      </div>
    ) : (
      <button className="secondary" onClick={() => setChatgptOpen(true)}>
        <ChatGPTIcon />
        Ask ChatGPT generally
      </button>
    );
  }
  function discussionAction() {
    return (
      <button
        className="secondary"
        onClick={() => beginThread(chat?.question ?? "")}
      >
        <MessageSquare size={17} />
        Post to team board
      </button>
    );
  }
  function answerChoices(showGeneral = false, showChatGPT = true) {
    return (
      <div className="answer-next-steps">
        <h3>How would you like to continue?</h3>
        <div
          className="answer-options"
          role="group"
          aria-label="Choose how to get help"
        >
          {showGeneral && (
            <section className="answer-option">
              <div className="answer-option-label">
                {cfg?.web_enabled ? (
                  <Globe size={18} />
                ) : cfg?.provider === "openai" ? (
                  <ChatGPTIcon />
                ) : (
                  <Monitor size={18} />
                )}
                {cfg?.web_enabled || cfg?.provider === "openai"
                  ? "Online"
                  : "On this computer"}
              </div>
              <h4>
                {cfg?.web_enabled
                  ? "Search the public web"
                  : cfg?.provider === "openai"
                    ? "Ask ChatGPT"
                    : "Local AI · general answer"}
              </h4>
              <p>
                {cfg?.web_enabled
                  ? "Search public sources through OpenAI. Only send a question without company or personal information."
                  : cfg?.provider === "openai"
                    ? "Send this general question to OpenAI without company documents. Only continue if it contains no private information."
                    : "Get a general answer from the AI running on this computer."}
              </p>
              <button className="secondary" onClick={general} disabled={busy}>
                {cfg?.web_enabled ? (
                  <Globe size={18} />
                ) : cfg?.provider === "openai" ? (
                  <ChatGPTIcon />
                ) : (
                  <Monitor size={18} />
                )}
                {cfg?.web_enabled
                  ? "Search public sources"
                  : cfg?.provider === "openai"
                    ? "Get a ChatGPT answer"
                    : "Ask local AI generally"}
              </button>
            </section>
          )}
          {showChatGPT && (
            <section className="answer-option">
              <div className="answer-option-label">
                <ChatGPTIcon />
                Online
              </div>
              <h4>Ask ChatGPT</h4>
              <p>
                Review your question before sending it to OpenAI. Company
                documents and chat history stay out of this request.
              </p>
              {chatgptOpen ? (
                <button
                  className="secondary"
                  onClick={() => setChatgptOpen(false)}
                >
                  <X size={18} />
                  Cancel ChatGPT request
                </button>
              ) : (
                chatgptAction()
              )}
            </section>
          )}
        </div>
        {showChatGPT && chatgptOpen && chatgptAction()}
        <section className="answer-team-help" aria-label="Ask your team">
          <div>
            <h4>
              <Users size={18} /> Need a company-specific answer?
            </h4>
            <p>
              Post to your team board so coworkers can help. An admin can
              confirm the answer for future company searches.
            </p>
          </div>
          {discussionAction()}
        </section>
      </div>
    );
  }
  useEffect(() => {
    if (!me) return;
    type Tool = {
      name: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => Promise<unknown>;
    };
    const context = (
      globalThis.document as Document & {
        modelContext?: {
          registerTool: (
            tool: Tool,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      {
        name: "read_workspace_overview",
        description:
          "Read the signed-in user’s accessible document titles and discussion titles. Does not query AI or send data to a cloud provider.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        async execute(input) {
          if (!input || typeof input !== "object" || Object.keys(input).length)
            throw new Error("Expected an empty object.");
          const d = await api<Dashboard>("/dashboard");
          setData(d);
          return {
            documents: d.documents.map((x) => ({ id: x.id, title: x.title })),
            discussions: d.threads.map((x) => ({
              id: x.id,
              title: x.title,
              status: x.status,
            })),
          };
        },
      },
      {
        name: "start_team_discussion",
        description:
          "Stage a company question in the visible discussion composer. This does not publish a discussion; the user reviews its text and audience before posting.",
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "string", minLength: 3, maxLength: 160 },
          },
          required: ["question"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          const x = input as { question?: unknown };
          if (
            !x ||
            typeof x.question !== "string" ||
            x.question.length < 3 ||
            x.question.length > 160 ||
            Object.keys(x).some((k) => k !== "question")
          )
            throw new Error("Provide a question between 3 and 160 characters.");
          setError("");
          setThreadDraft(x.question);
          setFilter("question");
          setNewThread(true);
          return { status: "staged", published: false };
        },
      },
    ];
    for (const tool of tools) {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => lifecycle.abort();
  }, [me?.id]);
  const navigation = [
    { id: "home", label: "Home", icon: Home },
    { id: "assistant", label: "Assistant", icon: Sparkles },
    { id: "discussions", label: "Discussions", icon: MessageSquare },
    { id: "library", label: "Knowledge library", icon: BookOpen },
    ...(me?.role === "admin"
      ? [{ id: "admin", label: "Admin", icon: ShieldCheck }]
      : []),
  ];
  const questions = data.threads.filter(
    (t) => t.kind === "question" && t.status !== "approved",
  );
  const discussions = data.threads.filter((t) => t.kind === "discussion");
  const departmentOptions = Array.from(
    new Set([
      "People",
      "Operations",
      "IT",
      "Finance",
      "management",
      ...data.threads.map((t) => t.author_department).filter(Boolean),
    ]),
  ).sort((a, b) => a.localeCompare(b));
  const visibleThreads = data.threads.filter(
    (t) =>
      (filter === "all" ||
        (filter === "approved"
          ? t.status === "approved"
          : t.kind === filter)) &&
      (departmentFilter === "all" ||
        t.author_department === departmentFilter) &&
      (filter !== "question" ||
        questionStatus === "all" ||
        (questionStatus === "answered"
          ? t.status === "approved"
          : t.status !== "approved")),
  );
  const conversationFiltersActive =
    departmentFilter !== "all" ||
    (filter === "question" && questionStatus !== "all");
  const recentQuestions = data.history
    .filter(
      (h, i, history) =>
        history.findIndex(
          (item) =>
            item.question.trim().toLowerCase() ===
            h.question.trim().toLowerCase(),
        ) === i,
    )
    .slice(0, 5);
  const visibleDocuments = data.documents.filter((d) =>
    d.title.toLowerCase().includes(librarySearch.toLowerCase()),
  );
  function threadCard(t: Thread) {
    return (
      <button
        className="thread-card"
        key={t.id}
        onClick={() => openThread(t.id)}
      >
        <div className="card-top">
          <span className="category">
            {t.kind === "question" ? "TEAM QUESTION" : "DISCUSSION"}
          </span>
          <Badge
            kind={
              t.status === "approved"
                ? "green"
                : t.kind === "question"
                  ? "amber"
                  : "blue"
            }
          >
            {t.status === "approved"
              ? "Approved"
              : t.kind === "question"
                ? "Needs an answer"
                : "Open"}
          </Badge>
        </div>
        <h3>{t.title}</h3>
        <p>{t.body}</p>
        <div className="card-footer">
          <span className="avatar small">{initials(t.author)}</span>
          <span className="thread-author">
            <span>{t.author.split(" ")[0]}</span>
            <small>
              {t.author_department === "management"
                ? "Management"
                : t.author_department}
            </small>
          </span>
          <span className="reply-count">
            <MessageSquare size={15} />
            {t.reply_count} {t.reply_count === 1 ? "reply" : "replies"}
          </span>
        </div>
      </button>
    );
  }
  function questionBox() {
    return (
      <form className="ask-box" onSubmit={ask}>
        <Search size={23} />
        <input
          aria-label="Your company question"
          placeholder="Ask about your company…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={2000}
          required
          minLength={3}
        />
        <button
          className="primary"
          disabled={busy || question.trim().length < 3}
        >
          {busy ? (
            <Loader2 className="spin" size={18} />
          ) : (
            <Sparkles size={17} />
          )}
          Ask AI
        </button>
      </form>
    );
  }

  if (!boot)
    return (
      <div className="loading-screen">
        <div className="brand">
          <span className="brand-mark">
            <MessageSquare size={24} />
          </span>
          AskLocal
        </div>
        {error ? (
          <p className="error">{error}</p>
        ) : (
          <Loader2 className="spin" />
        )}
      </div>
    );
  if (!me)
    return (
      <main className="auth-layout">
        <section className="auth-story">
          <div className="brand">
            <span className="brand-mark">
              <MessageSquare size={24} />
            </span>
            AskLocal
          </div>
          <div>
            <span className="eyebrow">KNOWLEDGE STARTS WITH A QUESTION</span>
            <h1>
              Your team knows.
              <br />
              Bring it together.
            </h1>
            <p>
              Find trusted answers, ask your colleagues, and keep good knowledge
              within reach.
            </p>
            <div className="auth-example">
              <Badge kind="green">
                <CheckCircle2 size={14} />
                Company knowledge
              </Badge>
              <h3>How do I claim a work expense?</h3>
              <p>
                Complete the expense form and attach your receipt. Your manager
                approves the claim.
              </p>
              <span>
                <FileText size={15} />
                Expense claims · Section 1
              </span>
            </div>
          </div>
          <small>
            Runs on your computer. Your workspace, your choice of AI.
          </small>
        </section>
        <section className="auth-form">
          <div className="auth-form-inner">
            <span className="eyebrow">
              {boot.ready ? "WELCOME BACK" : "YOUR LOCAL WORKSPACE"}
            </span>
            <h2>
              {boot.ready
                ? "Sign in to AskLocal"
                : "Make room for better answers."}
            </h2>
            <p>
              {boot.ready
                ? "Sign in with your workspace account."
                : "Create your admin account to get started."}
            </p>
            <form onSubmit={signIn}>
              {!boot.ready && (
                <label>
                  Your name
                  <input
                    required
                    value={auth.name}
                    onChange={(e) => setAuth({ ...auth, name: e.target.value })}
                  />
                </label>
              )}
              <label>
                Email
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={auth.email}
                  onChange={(e) => setAuth({ ...auth, email: e.target.value })}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  required
                  minLength={boot.ready ? 1 : 10}
                  autoComplete={
                    boot.ready ? "current-password" : "new-password"
                  }
                  value={auth.password}
                  onChange={(e) =>
                    setAuth({ ...auth, password: e.target.value })
                  }
                />
                {!boot.ready && (
                  <small className="field-help">
                    Use at least 10 characters.
                  </small>
                )}
              </label>
              {!boot.ready && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={auth.demo}
                    onChange={(e) =>
                      setAuth({ ...auth, demo: e.target.checked })
                    }
                  />
                  Include a fictional company to try the app
                </label>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary full" disabled={busy}>
                {busy ? <Loader2 size={18} className="spin" /> : null}
                {boot.ready ? "Sign in" : "Create workspace"}
              </button>
            </form>
            {boot.demo && (
              <div className="hint">
                Fictional demo employee: <strong>amy@demo.test</strong>
                <br />
                Password: <strong>demo-only-123</strong>
              </div>
            )}
            <p className="auth-footnote">
              Local AI needs Ollama and a downloaded model. You can choose the
              model in Settings.
            </p>
          </div>
        </section>
      </main>
    );

  return (
    <div className="app-layout">
      <aside
        id="workspace-navigation"
        className={"sidebar " + (menu ? "mobile-open" : "")}
      >
        <div className="sidebar-header">
          <button
            className="brand brand-button"
            onClick={() => {
              setPage("home");
              setMenu(false);
            }}
          >
            <span className="brand-mark">
              <MessageSquare size={23} />
            </span>
            AskLocal
          </button>
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          >
            <X size={21} />
          </button>
        </div>
        <div className="workspace-label">COMPANY WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              className={"nav-item " + (page === n.id ? "active" : "")}
              onClick={() => {
                setPage(n.id);
                setMenu(false);
                setFilter("all");
              }}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "discussions" && questions.length > 0 && (
                <span className="nav-count">{questions.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-scroll">
          <div className="sidebar-section">
            <span className="side-heading">RECENT QUESTIONS</span>
            {recentQuestions.length ? (
              recentQuestions.map((h) => (
                <button
                  key={h.id}
                  className="side-link"
                  title={h.question}
                  onClick={() => {
                    api<Chat>("/chats/" + h.id)
                      .then(setChat)
                      .catch(fail);
                    setPage("assistant");
                    setMenu(false);
                  }}
                >
                  <MessageSquare size={14} />
                  <span>{h.question}</span>
                </button>
              ))
            ) : (
              <p className="side-empty">Your questions will appear here.</p>
            )}
          </div>
          <div className="sidebar-section">
            <span className="side-heading">JUMP TO A DISCUSSION</span>
            {data.threads.slice(0, 3).map((t) => (
              <button
                key={t.id}
                className="side-link"
                title={t.title}
                onClick={() => {
                  openThread(t.id);
                  setMenu(false);
                }}
              >
                <span className="hash">#</span>
                <span>{t.title}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="sidebar-bottom">
          <button
            className={"nav-item " + (page === "settings" ? "active" : "")}
            onClick={() => {
              setPage("settings");
              setMenu(false);
            }}
          >
            <Settings size={19} />
            Settings
          </button>
          <div className="profile">
            <span className="avatar">{initials(me.name)}</span>
            <div>
              <strong>{me.name}</strong>
              <span>
                {me.role === "admin" ? "Workspace admin" : me.department}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await post("/logout", {});
                  csrf = "";
                  setMe(null);
                  setChat(null);
                  setThread(null);
                  setDocument(null);
                  setMenu(false);
                  setPage("home");
                } catch (e) {
                  fail(e);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-controls="workspace-navigation"
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>
              {navigation.find((n) => n.id === page)?.label || "Settings"}
            </strong>
          </div>
          <div className="top-right">
            <span className="company-wordmark">company</span>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {page === "home" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR TEAM, CONNECTED</span>
                  <h1>
                    Good questions.
                    <br className="mobile-break" /> Shared answers.
                  </h1>
                  <p>
                    Find what you need, or start a conversation with your team.
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => beginThread("", "discussion")}
                >
                  <Plus size={18} />
                  New discussion
                </button>
              </div>
              {questionBox()}
              <div className="suggestions">
                <span>Try asking</span>
                {[
                  "Where is Amy?",
                  "How do I claim an expense?",
                  "How do I book a meeting room?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => ask(undefined, q)}
                    disabled={busy}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <span className="section-icon amber">
                      <HelpCircle size={20} />
                    </span>
                    <div>
                      <h2>Questions for the team</h2>
                      <p>Help fill the gaps in our company knowledge.</p>
                    </div>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      setPage("discussions");
                      setFilter("question");
                    }}
                  >
                    View all questions
                  </button>
                </div>
                <div className="card-grid">
                  {questions.length ? (
                    questions.slice(0, 3).map(threadCard)
                  ) : (
                    <Empty text="No unanswered questions. Start one when you need help." />
                  )}
                </div>
              </section>
              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <span className="section-icon blue">
                      <MessageSquare size={20} />
                    </span>
                    <div>
                      <h2>Around the workplace</h2>
                      <p>Plans, ideas and conversations beyond the handbook.</p>
                    </div>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      setPage("discussions");
                      setFilter("discussion");
                    }}
                  >
                    View all discussions
                  </button>
                </div>
                <div className="card-grid">
                  {discussions.length ? (
                    discussions.slice(0, 3).map(threadCard)
                  ) : (
                    <Empty text="Start a discussion to bring your team together." />
                  )}
                </div>
              </section>
              <div className="knowledge-strip">
                <div className="section-icon blue">
                  <BookOpen size={22} />
                </div>
                <div>
                  <h3>Answers with something behind them.</h3>
                  <p>
                    {data.documents.length} documents and confirmed answers in
                    your knowledge library.
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => setPage("library")}
                >
                  Explore the library
                </button>
              </div>
            </>
          )}
          {page === "assistant" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">ASK YOUR WORKSPACE</span>
                  <h1>What do you need to know?</h1>
                  <p>
                    {cfg?.provider === "openai"
                      ? "OpenAI receives your question and selected company passages."
                      : "Answers come from company information you can access."}
                  </p>
                </div>
              </div>
              {questionBox()}
              {busy ? (
                <div className="thinking">
                  <Loader2 className="spin" size={24} />
                  <div>
                    <strong>Looking for an answer…</strong>
                    <p>Checking your accessible sources.</p>
                  </div>
                </div>
              ) : chat ? (
                <article className="answer-panel">
                  <div className="answer-question">
                    <span className="avatar">{initials(me.name)}</span>
                    <h2>{chat.question}</h2>
                  </div>
                  <div className="answer-content">
                    <div className="answer-label">
                      <Sparkles size={20} />
                      <strong>AskLocal</strong>
                      <Badge
                        kind={chat.route === "knowledge" ? "green" : "blue"}
                      >
                        {chat.route === "knowledge"
                          ? "Company knowledge"
                          : chat.route === "web"
                            ? "Public web sources"
                            : chat.route === "general_answer"
                              ? chat.provider === "openai"
                                ? "ChatGPT answer"
                                : "Local general answer"
                              : chat.route === "general"
                                ? "General question"
                                : chat.route === "company"
                                  ? "Needs team input"
                                  : chat.route === "stale"
                                    ? "Source changed"
                                    : "Follow-up"}
                      </Badge>
                    </div>
                    <AnswerText
                      text={
                        chat.route === "general"
                          ? "We couldn’t find an answer in company knowledge. Choose an AI below for a general answer, or ask your team."
                          : chat.answer
                      }
                    />
                    {chat.sources.length > 0 && (
                      <div className="sources">
                        <h3>Sources</h3>
                        {chat.sources.map((s, i) =>
                          s.url ? (
                            <a
                              className="source-card"
                              key={i}
                              href={s.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink size={18} />
                              <span>
                                <strong>{s.title}</strong>
                                <small>Public web source</small>
                              </span>
                            </a>
                          ) : (
                            <button
                              className="source-card"
                              key={i}
                              onClick={() => openDocument(s.id!, s.chunk_id)}
                            >
                              <FileText size={18} />
                              <span>
                                <strong>{s.title}</strong>
                                <small>{s.location}</small>
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                    )}
                    {chat.route === "company" && (
                      <>
                        {!!chat.similar_threads?.length && (
                          <div className="answer-actions">
                            {chat.similar_threads?.map((t) => (
                              <button
                                className="secondary"
                                key={t.id}
                                onClick={() => openThread(t.id)}
                              >
                                <MessageSquare size={17} />
                                {t.title}
                              </button>
                            ))}
                          </div>
                        )}
                        {answerChoices()}
                      </>
                    )}
                    {chat.route === "general" &&
                      answerChoices(
                        true,
                        cfg?.provider !== "openai" || !!cfg?.web_enabled,
                      )}
                    {chat.route === "general_answer" &&
                      answerChoices(false, chat.provider !== "openai")}
                    <div className="feedback">
                      <span>Was this useful?</span>
                      <button onClick={() => feedback("helpful")}>
                        <ThumbsUp size={15} />
                        Yes
                      </button>
                      <button onClick={() => feedback("incorrect")}>
                        <Flag size={15} />
                        Report incorrect
                      </button>
                      <button onClick={() => feedback("outdated")}>
                        <Clock3 size={15} />
                        Outdated
                      </button>
                      <small>Reports share this question with the admin.</small>
                    </div>
                  </div>
                </article>
              ) : (
                <div className="assistant-empty">
                  <div className="section-icon blue">
                    <Sparkles size={29} />
                  </div>
                  <h2>A good place to start.</h2>
                  <p>
                    Ask about onboarding, company processes or office
                    information.
                  </p>
                  <div className="sample-questions">
                    {[
                      "Where is Amy?",
                      "How do I claim an expense?",
                      "Can we work remotely during an office closure?",
                    ].map((q) => (
                      <button
                        className="secondary"
                        key={q}
                        onClick={() => ask(undefined, q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {page === "discussions" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">BETTER TOGETHER</span>
                  <h1>Team conversations</h1>
                  <p>
                    Ask for help, share ideas and turn answers into knowledge.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => beginThread("", "discussion")}
                >
                  <Plus size={18} />
                  New discussion
                </button>
              </div>
              <div
                className="tabs"
                role="group"
                aria-label="Filter discussions"
              >
                {[
                  ["all", "All conversations"],
                  ["question", "Questions"],
                  ["discussion", "Staff discussions"],
                  ["approved", "Approved answers"],
                ].map(([id, label]) => (
                  <button
                    className={filter === id ? "selected" : ""}
                    aria-pressed={filter === id}
                    key={id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="conversation-filters">
                <label>
                  Posted by department
                  <select
                    aria-label="Filter by department"
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                  >
                    <option value="all">All departments</option>
                    {departmentOptions.map((d) => (
                      <option key={d} value={d}>
                        {d === "management" ? "Management" : d}
                      </option>
                    ))}
                  </select>
                </label>
                {filter === "question" && (
                  <label>
                    Question status
                    <select
                      aria-label="Filter by question status"
                      value={questionStatus}
                      onChange={(e) => setQuestionStatus(e.target.value)}
                    >
                      <option value="all">All questions</option>
                      <option value="unanswered">Unanswered</option>
                      <option value="answered">Answered</option>
                    </select>
                  </label>
                )}
                <div className="conversation-filter-summary">
                  <p role="status">
                    {visibleThreads.length}{" "}
                    {visibleThreads.length === 1
                      ? "conversation"
                      : "conversations"}
                  </p>
                  {conversationFiltersActive && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setDepartmentFilter("all");
                        setQuestionStatus("all");
                      }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
              <div className="card-grid">{visibleThreads.map(threadCard)}</div>
              {!visibleThreads.length && (
                <Empty
                  text={
                    conversationFiltersActive
                      ? "No conversations match these filters. Clear filters to see more."
                      : filter === "approved"
                        ? "No approved answers yet. An admin can confirm an answer from a team question."
                        : "Nothing here yet. Start the first conversation."
                  }
                />
              )}
            </>
          )}
          {page === "library" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A SOURCE YOU CAN CHECK</span>
                  <h1>Company knowledge</h1>
                  <p>Documents and confirmed answers available to you.</p>
                </div>
                {me.role === "admin" && (
                  <button className="primary" onClick={() => setUpload(true)}>
                    <Upload size={18} />
                    Add document
                  </button>
                )}
              </div>
              <div className="library-search">
                <Search size={20} />
                <input
                  placeholder="Search document titles…"
                  aria-label="Search document titles"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                />
              </div>
              <div className="card-grid">
                {visibleDocuments.map((d) => (
                  <button
                    className="document-card"
                    key={d.id}
                    onClick={() => openDocument(d.id)}
                  >
                    <div className="card-top">
                      <span className="section-icon blue">
                        <FileText size={23} />
                      </span>
                      <Badge kind={d.thread_id ? "green" : "blue"}>
                        {d.thread_id ? "Confirmed answer" : "Document"}
                      </Badge>
                    </div>
                    <h3>{d.title}</h3>
                    <p>{d.category}</p>
                    <div className="document-meta">
                      <span>
                        <Users size={14} />
                        {d.audience === "everyone" ? "Everyone" : d.audience}
                      </span>
                      <span>{date(d.created)}</span>
                    </div>
                  </button>
                ))}
              </div>
              {!visibleDocuments.length && (
                <Empty
                  text={
                    librarySearch
                      ? "No documents match that title. Try another search or clear the search box."
                      : me.role === "admin"
                        ? "Add your first company document to get started."
                        : "No company documents are available to you yet."
                  }
                />
              )}
            </>
          )}
          {page === "settings" && cfg && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR WORKSPACE, YOUR CHOICE</span>
                  <h1>AI & workspace settings</h1>
                  <p>
                    Choose how answers are generated and where questions are
                    processed.
                  </p>
                </div>
              </div>
              {me.role !== "admin" && (
                <p className="hint">
                  These settings are managed by your workspace admin. You can
                  check the connection status below.
                </p>
              )}
              <form
                className="settings-panel"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await api("/settings", {
                      method: "PUT",
                      body: JSON.stringify(cfg),
                    });
                    await refreshSettings();
                    setNotice("Settings saved.");
                  } catch (e) {
                    fail(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h2>Answer provider</h2>
                <div className="provider-options">
                  <label
                    className={
                      "provider-option " +
                      (cfg.provider === "local" ? "chosen" : "")
                    }
                  >
                    <input
                      type="radio"
                      name="provider"
                      checked={cfg.provider === "local"}
                      disabled={me.role !== "admin"}
                      onChange={() => setCfg({ ...cfg, provider: "local" })}
                    />
                    <div>
                      <strong>
                        <Lock size={18} />
                        Local AI
                      </strong>
                      <p>
                        Company questions and passages stay on this computer.
                      </p>
                    </div>
                  </label>
                  <label
                    className={
                      "provider-option " +
                      (cfg.provider === "openai" ? "chosen" : "")
                    }
                  >
                    <input
                      type="radio"
                      name="provider"
                      checked={cfg.provider === "openai"}
                      disabled={me.role !== "admin"}
                      onChange={() => setCfg({ ...cfg, provider: "openai" })}
                    />
                    <div>
                      <strong>
                        <ExternalLink size={18} />
                        OpenAI API
                      </strong>
                      <p>
                        Selected company information is sent to OpenAI. Requires
                        your own API key.
                      </p>
                    </div>
                  </label>
                </div>
                <div className="field-grid">
                  <label>
                    Local answer model
                    <input
                      list="models"
                      value={cfg.model}
                      disabled={me.role !== "admin"}
                      onChange={(e) =>
                        setCfg({ ...cfg, model: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Local embedding model
                    <input
                      value={cfg.embedding_model}
                      disabled={me.role !== "admin"}
                      onChange={(e) =>
                        setCfg({ ...cfg, embedding_model: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    OpenAI model
                    <input
                      value={cfg.openai_model}
                      disabled={me.role !== "admin"}
                      onChange={(e) =>
                        setCfg({ ...cfg, openai_model: e.target.value })
                      }
                    />
                  </label>
                </div>
                <datalist id="models">
                  {cfg.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <label className="checkbox web-option">
                  <input
                    type="checkbox"
                    checked={cfg.web_enabled}
                    disabled={me.role !== "admin"}
                    onChange={(e) =>
                      setCfg({ ...cfg, web_enabled: e.target.checked })
                    }
                  />
                  <div>
                    <strong>Enable public web search</strong>
                    <p>
                      General questions can be sent to OpenAI. Company documents
                      are excluded from web requests.
                    </p>
                  </div>
                </label>
                {me.role === "admin" && (
                  <button className="primary" disabled={busy}>
                    Save settings
                  </button>
                )}
              </form>
              <div className="settings-panel">
                <div className="section-heading">
                  <div>
                    <Database size={22} />
                    <h2>Connection & knowledge index</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => refreshSettings().catch(fail)}
                  >
                    Refresh status
                  </button>
                </div>
                <div className="status-grid">
                  <div>
                    <span>Ollama</span>
                    <strong>
                      {cfg.ollama_connected ? "Connected" : "Not running"}
                    </strong>
                  </div>
                  <div>
                    <span>OpenAI API key</span>
                    <strong>
                      {cfg.api_key_set ? "Configured" : "Not configured"}
                    </strong>
                  </div>
                  <div>
                    <span>Semantic index</span>
                    <strong>
                      {cfg.indexed} / {cfg.total} passages
                    </strong>
                  </div>
                </div>
                <p className="muted">
                  Documents are immediately searchable by keyword. Build the
                  semantic index to also find passages by meaning.
                </p>
                {cfg.index.error && <p className="error">{cfg.index.error}</p>}
                {me.role === "admin" && (
                  <button
                    className="secondary"
                    disabled={cfg.index.running}
                    onClick={async () => {
                      try {
                        await post("/reindex", {});
                        await refreshSettings();
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  >
                    {cfg.index.running ? (
                      <Loader2 className="spin" size={17} />
                    ) : (
                      <Database size={17} />
                    )}{" "}
                    {cfg.index.running
                      ? "Building index…"
                      : "Build semantic index"}
                  </button>
                )}
                <details>
                  <summary>Setup help</summary>
                  <p>
                    Start the Ollama application, then download your models in
                    the VS Code terminal:
                  </p>
                  <pre>
                    ollama pull qwen3.5:4b{"\n"}ollama pull qwen3-embedding:0.6b
                  </pre>
                  <p>
                    For optional OpenAI features, copy .env.example to .env, add
                    your own OPENAI_API_KEY and restart AskLocal. Never share or
                    commit your key.
                  </p>
                </details>
              </div>
            </>
          )}
          {page === "admin" && adminData && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">KEEP KNOWLEDGE TRUSTWORTHY</span>
                  <h1>Workspace admin</h1>
                  <p>
                    Review answers, look after your team and keep information
                    current.
                  </p>
                </div>
              </div>
              <div className="settings-panel">
                <h2>Questions awaiting an answer</h2>
                {questions.length ? (
                  questions.map((t) => (
                    <button
                      className="admin-row"
                      key={t.id}
                      onClick={() => openThread(t.id)}
                    >
                      <HelpCircle size={19} />
                      <span>{t.title}</span>
                      <Badge kind="amber">Review</Badge>
                    </button>
                  ))
                ) : (
                  <p className="muted">No unanswered questions.</p>
                )}
              </div>
              <div className="settings-panel">
                <h2>Answer reports</h2>
                <p className="muted">
                  Submitting a report shares the question with the admin.
                </p>
                {adminData.reports.length ? (
                  adminData.reports.map((r) => (
                    <div className="admin-row" key={r.id}>
                      <Flag size={18} />
                      <div>
                        <strong>{r.question}</strong>
                        <small>
                          {r.author} · {r.kind}
                        </small>
                      </div>
                      <button
                        className="secondary"
                        onClick={async () => {
                          try {
                            await post("/feedback/" + r.id + "/resolve", {});
                            setAdminData(await api("/admin"));
                            setNotice("Report marked reviewed.");
                          } catch (e) {
                            fail(e);
                          }
                        }}
                      >
                        Mark reviewed
                      </button>
                    </div>
                  ))
                ) : (
                  <p>No reports to review.</p>
                )}
              </div>
              <div className="settings-panel">
                <h2>Team members</h2>
                {adminData.members.map((u) => (
                  <div className="admin-row" key={u.id}>
                    <span className="avatar small">{initials(u.name)}</span>
                    <div>
                      <strong>{u.name}</strong>
                      <small>{u.email}</small>
                    </div>
                    <Badge>{u.department}</Badge>
                    <Badge kind="blue">{u.role}</Badge>
                  </div>
                ))}
                <details>
                  <summary>Add a team member</summary>
                  <form
                    className="member-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      setBusy(true);
                      try {
                        await post("/members", Object.fromEntries(f));
                        setAdminData(await api("/admin"));
                        setNotice("Member added.");
                      } catch (e) {
                        fail(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <div className="field-grid">
                      <label>
                        Name
                        <input name="name" required />
                      </label>
                      <label>
                        Email
                        <input name="email" type="email" required />
                      </label>
                      <label>
                        Initial password
                        <input
                          name="password"
                          type="password"
                          minLength={10}
                          required
                        />
                        <small className="field-help">
                          Use at least 10 characters.
                        </small>
                      </label>
                      <label>
                        Department
                        <select name="department">
                          {[
                            "Operations",
                            "People",
                            "IT",
                            "Finance",
                            "management",
                          ].map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Role
                        <select name="role">
                          <option value="employee">Employee</option>
                          <option value="admin">Admin</option>
                        </select>
                      </label>
                    </div>
                    <button className="primary" disabled={busy}>
                      Add member
                    </button>
                  </form>
                </details>
              </div>
              <div className="settings-panel">
                <h2>Recent changes</h2>
                {adminData.audit.length ? (
                  adminData.audit.map((a) => (
                    <div className="admin-row" key={a.id}>
                      <CheckCircle2 size={17} />
                      <span>{a.event}</span>
                      <small>{date(a.created)}</small>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Uploads and approvals will appear here.
                  </p>
                )}
              </div>
            </>
          )}
        </main>
        <footer className="workspace-footer">
          Company answers use approved sources. Check the original when it
          matters.
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {notice}
        </div>
      )}
      {newThread && (
        <Modal
          error={error}
          title="Start a conversation"
          onClose={() => setNewThread(false)}
        >
          <form onSubmit={createThread}>
            <p className="muted">
              Review your question and choose who can see it. Your private chat
              history is not included.
            </p>
            <label>
              Title
              <input
                name="title"
                defaultValue={threadDraft.slice(0, 160)}
                required
                minLength={3}
                maxLength={160}
              />
            </label>
            <label>
              What would you like to share?
              <textarea
                name="body"
                defaultValue={threadDraft}
                required
                minLength={3}
                maxLength={6000}
                rows={5}
              />
            </label>
            <div className="field-grid">
              <label>
                Type
                <select
                  name="kind"
                  defaultValue={
                    filter === "discussion" ? "discussion" : "question"
                  }
                >
                  <option value="question">Question needing an answer</option>
                  <option value="discussion">Staff discussion</option>
                </select>
              </label>
              <label>
                Audience
                <select name="audience">
                  <option value="everyone">Everyone</option>
                  {(me.role === "admin"
                    ? ["People", "Operations", "IT", "Finance", "management"]
                    : [me.department]
                  ).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="primary" disabled={busy}>
              Post discussion
            </button>
          </form>
        </Modal>
      )}
      {thread && (
        <Modal
          error={error}
          title="Team conversation"
          wide
          onClose={() => setThread(null)}
        >
          <div className="thread-detail">
            <div className="card-top">
              <Badge kind={thread.status === "approved" ? "green" : "amber"}>
                {thread.status === "approved"
                  ? "Approved answer"
                  : thread.kind === "question"
                    ? "Needs an answer"
                    : "Staff discussion"}
              </Badge>
              <span className="muted">
                {thread.audience === "everyone" ? "Everyone" : thread.audience}
              </span>
            </div>
            <h2>{thread.title}</h2>
            <span className="muted">
              {thread.author} · {date(thread.created)}
            </span>
            <p className="preserve">{thread.body}</p>
            {thread.approved && (
              <div className="approved-answer">
                <strong>
                  <ShieldCheck size={18} />
                  Confirmed company answer
                </strong>
                <p className="preserve">{thread.approved.content}</p>
                <button
                  className="text-button"
                  onClick={() => openDocument(thread.approved!.id)}
                >
                  View knowledge source
                </button>
              </div>
            )}
            <h3>Replies</h3>
            {thread.replies?.length ? (
              thread.replies.map((r) => (
                <div className="reply" key={r.id}>
                  <span className="avatar small">{initials(r.author)}</span>
                  <div>
                    <strong>{r.author}</strong>
                    <p className="preserve">{r.body}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">No replies yet. Share what you know.</p>
            )}
            <form onSubmit={sendReply}>
              <label>
                Add a reply
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  required
                  minLength={2}
                  maxLength={6000}
                  rows={3}
                />
              </label>
              <button className="primary" disabled={busy}>
                Post reply
              </button>
            </form>
            {me.role === "admin" && (
              <form className="approval-form" onSubmit={approveAnswer}>
                <h3>Confirm an answer for future questions</h3>
                <p className="muted">
                  Review the information before approving. Only this confirmed
                  answer becomes company knowledge.
                </p>
                <label>
                  Confirmed answer
                  <textarea
                    value={approved}
                    onChange={(e) => setApproved(e.target.value)}
                    minLength={2}
                    maxLength={6000}
                    required
                    rows={4}
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  <ShieldCheck size={17} />
                  Approve as company knowledge
                </button>
              </form>
            )}
          </div>
        </Modal>
      )}
      {document && (
        <Modal
          error={error}
          title="Knowledge source"
          wide
          onClose={() => setDocument(null)}
        >
          <div className="card-top">
            <Badge kind={document.thread_id ? "green" : "blue"}>
              {document.thread_id ? "Approved discussion" : "Company document"}
            </Badge>
            <span className="muted">
              {document.audience === "everyone"
                ? "Everyone"
                : document.audience}
            </span>
          </div>
          <h2>{document.title}</h2>
          {document.passages?.map((p) => (
            <section
              className={"passage " + (highlight === p.id ? "highlight" : "")}
              key={p.id}
            >
              <strong>{p.location}</strong>
              <p className="preserve">{p.content}</p>
            </section>
          ))}
          {me.role === "admin" && (
            <button
              className="danger"
              onClick={async () => {
                if (
                  !confirm(
                    "Withdraw this source? It will no longer be used for company answers.",
                  )
                )
                  return;
                try {
                  await api("/documents/" + document.id, { method: "DELETE" });
                  setDocument(null);
                  await refresh();
                  await refreshSettings();
                  setNotice("Source withdrawn.");
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Withdraw source
            </button>
          )}
        </Modal>
      )}
      {upload && (
        <Modal
          error={error}
          title="Add company knowledge"
          onClose={() => setUpload(false)}
        >
          <form onSubmit={uploadDocument}>
            <p className="muted">
              Upload a text PDF, Markdown or plain-text document. Choose its
              audience before saving.
            </p>
            <label>
              Document title
              <input name="title" required maxLength={160} />
            </label>
            <label>
              File
              <input type="file" name="file" accept=".pdf,.txt,.md" required />
            </label>
            <label>
              Who can access it?
              <select name="audience">
                <option value="everyone">Everyone</option>
                {["People", "Operations", "IT", "Finance", "management"].map(
                  (d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ),
                )}
              </select>
            </label>
            <p className="hint">
              Maximum 10 MB. Scanned PDFs need text recognition first. Keep
              passwords and sensitive personal records out of this prototype.
            </p>
            <button className="primary" disabled={busy}>
              <Upload size={17} />
              Save document
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
