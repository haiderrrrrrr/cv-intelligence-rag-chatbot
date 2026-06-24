"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  BarChart3,
  Bot,
  BrainCircuit,
  FileText,
  Gauge,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  SendHorizontal,
  Server,
  Trash2,
  UploadCloud,
  Zap,
} from "lucide-react";

type View = "dashboard" | "chatbot" | "rag" | "processing";
type Mode = "chat" | "rag";

type RagSource = {
  chunk: number;
  document?: string;
  document_chunk?: number;
  score: number;
  snippet: string;
};

type ChatMessage = {
  role: "user" | "assistant" | "system";
  text: string;
  sources?: RagSource[];
};

type HistoryItem = {
  question: string;
  answer: string;
  mode: string;
};

type HealthResponse = {
  gemini_key_configured: boolean;
  active_cv: string | null;
  active_cvs: string[];
  cv_count: number;
  cv_uploaded: boolean;
  model: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type ButtonVariant = "primary" | "secondary" | "danger";

const buttonBase =
  "inline-flex h-12 items-center justify-center gap-3 rounded-xl px-6 text-sm font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-gradient-to-r from-primary-container to-secondary text-white shadow-lg shadow-primary-container/20 hover:shadow-xl hover:shadow-primary-container/30 hover:-translate-y-0.5",
  secondary: "border border-border bg-surface-container/60 text-on-surface hover:bg-surface-container-high hover:border-primary/30 hover:shadow-md",
  danger: "bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-700",
};

function buttonClass(variant: ButtonVariant = "secondary", className = "") {
  return `${buttonBase} ${buttonVariants[variant]} ${className}`.trim();
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>("dashboard");
  const [question, setQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [ragMessages, setRagMessages] = useState<ChatMessage[]>([]);
  const [chatHistory, setChatHistory] = useState<HistoryItem[]>([]);
  const [ragHistory, setRagHistory] = useState<HistoryItem[]>([]);
  const [apiStatus, setApiStatus] = useState("Checking");
  const [model, setModel] = useState("Gemini");
  const [activeCvs, setActiveCvs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastAction, setLastAction] = useState("Waiting for documents");
  const [showNewAnalysisDialog, setShowNewAnalysisDialog] = useState(false);

  const hasCv = activeCvs.length > 0;
  const activeMode: Mode = view === "chatbot" ? "chat" : "rag";
  const currentMessages = activeMode === "chat" ? chatMessages : ragMessages;
  const activeHistoryCount = activeMode === "chat" ? chatHistory.length : ragHistory.length;
  const documentSummary = hasCv ? `${activeCvs.length} document${activeCvs.length > 1 ? "s" : ""} ready` : "No documents added";

  const ragPlaceholder = useMemo(
    () => (hasCv ? "Ask about skills, experience, projects, or compare uploaded profiles" : "Add documents from Processing to start"),
    [hasCv],
  );

  async function refreshHealth() {
    try {
      const response = await fetch(`${apiBase}/health`, { cache: "no-store" });
      const data = (await response.json()) as HealthResponse;
      setApiStatus(data.gemini_key_configured ? "Connected" : "Fallback mode");
      setActiveCvs(data.active_cvs || []);
      setModel(data.model || "Gemini");
    } catch {
      setApiStatus("Backend offline");
      setActiveCvs([]);
    }
  }

  async function refreshHistory() {
    try {
      const [chatResponse, ragResponse] = await Promise.all([
        fetch(`${apiBase}/history/chat`, { cache: "no-store" }),
        fetch(`${apiBase}/history/rag`, { cache: "no-store" }),
      ]);
      const chatData = await chatResponse.json();
      const ragData = await ragResponse.json();
      setChatHistory(chatData.items || []);
      setRagHistory(ragData.items || []);
    } catch {
      setChatHistory([]);
      setRagHistory([]);
    }
  }

  useEffect(() => {
    refreshHealth();
    refreshHistory();
  }, []);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;

    if (activeMode === "rag" && !hasCv) {
      setRagMessages((items) => [...items, { role: "system", text: "Add at least one CV before asking document-based questions." }]);
      return;
    }

    setQuestion("");
    setIsLoading(true);
    const setMessages = activeMode === "chat" ? setChatMessages : setRagMessages;
    setMessages((items) => [...items, { role: "user", text: trimmed }, { role: "assistant", text: "Thinking..." }]);

    try {
      const response = await fetch(`${apiBase}/${activeMode === "chat" ? "chat" : "ask"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Request failed");

      setMessages((items) => {
        const next = [...items];
        next[next.length - 1] = { role: "assistant", text: data.answer, sources: data.sources || [] };
        return next;
      });
      setLastAction(activeMode === "chat" ? "Chat response completed" : "Document answer completed");
      await refreshHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setMessages((items) => {
        const next = [...items];
        next[next.length - 1] = { role: "assistant", text: `Error: ${message}` };
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function uploadCvs(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setView("processing");
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append("files", file));

    try {
      const response = await fetch(`${apiBase}/upload-cvs`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Upload failed");
      setRagMessages([{ role: "system", text: `${data.cv_count} document${data.cv_count > 1 ? "s" : ""} added. You can ask document-based questions now.` }]);
      setLastAction(`${data.cv_count} document${data.cv_count > 1 ? "s" : ""} added`);
      await refreshHealth();
      await refreshHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected upload error";
      setRagMessages([{ role: "system", text: `Upload failed: ${message}` }]);
      setLastAction(`Upload failed: ${message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeCvs() {
    const response = await fetch(`${apiBase}/cv`, { method: "DELETE" });
    if (response.ok) {
      setActiveCvs([]);
      setRagMessages([{ role: "system", text: "Document workspace cleared." }]);
      setLastAction("Documents cleared");
      await refreshHistory();
      await refreshHealth();
    }
  }

  async function clearActiveHistory() {
    await fetch(`${apiBase}/history/${activeMode}`, { method: "DELETE" });
    if (activeMode === "chat") setChatMessages([]);
    if (activeMode === "rag") setRagMessages([]);
    setLastAction(`${activeMode === "chat" ? "Chatbot" : "Document"} conversation cleared`);
    await refreshHistory();
  }

  async function newAnalysis() {
    await Promise.all([fetch(`${apiBase}/cv`, { method: "DELETE" }), fetch(`${apiBase}/history`, { method: "DELETE" })]);
    setQuestion("");
    setActiveCvs([]);
    setChatMessages([]);
    setRagMessages([]);
    setChatHistory([]);
    setRagHistory([]);
    setLastAction("New workspace started");
    setView("processing");
    await refreshHealth();
    setShowNewAnalysisDialog(false);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <input ref={fileInputRef} className="hidden" multiple type="file" accept=".pdf,.txt,.md" onChange={(event) => uploadCvs(event.target.files)} />
      <Sidebar activeView={view} onNewAnalysisClick={() => setShowNewAnalysisDialog(true)} setView={setView} />
      <section className="min-h-screen lg:pl-[280px]">
        <TopBar apiStatus={apiStatus} model={model} />
        <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-8">
          {view === "dashboard" ? (
            <Dashboard
              apiStatus={apiStatus}
              chatCount={chatHistory.length}
              documentSummary={documentSummary}
              lastAction={lastAction}
              model={model}
              ragCount={ragHistory.length}
              setView={setView}
            />
          ) : null}
          {view === "chatbot" ? (
            <ConversationPanel
              activeHistoryCount={activeHistoryCount}
              ask={ask}
              clearHistory={clearActiveHistory}
              disabled={false}
              isLoading={isLoading}
              messages={currentMessages}
              placeholder="Ask the general chatbot anything"
              question={question}
              setQuestion={setQuestion}
              title="Chatbot"
              eyebrow="General Assistant"
            />
          ) : null}
          {view === "rag" ? (
            <ConversationPanel
              activeHistoryCount={activeHistoryCount}
              ask={ask}
              clearHistory={clearActiveHistory}
              disabled={!hasCv}
              isLoading={isLoading}
              messages={currentMessages}
              placeholder={ragPlaceholder}
              question={question}
              setQuestion={setQuestion}
              title="RAG CV Intelligence"
              eyebrow={documentSummary}
            />
          ) : null}
          {view === "processing" ? (
            <Processing
              activeCvs={activeCvs}
              documentSummary={documentSummary}
              lastAction={lastAction}
              removeCvs={removeCvs}
              startUpload={() => fileInputRef.current?.click()}
              uploading={uploading}
            />
          ) : null}
        </div>
      </section>

      {showNewAnalysisDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Panel className="max-w-md w-full mx-4">
            <h3 className="text-2xl font-bold font-display mb-4">Start New Analysis?</h3>
            <p className="text-on-surface-variant mb-8">
              This will clear all uploaded CVs, chat history, and document history. Everything will be lost and cannot be undone.
            </p>
            <div className="flex gap-4 justify-end">
              <button className={buttonClass("secondary", "h-12 px-6")} onClick={() => setShowNewAnalysisDialog(false)} type="button">
                Cancel
              </button>
              <button className={buttonClass("danger", "h-12 px-6")} onClick={newAnalysis} type="button">
                Yes, Start New
              </button>
            </div>
          </Panel>
        </div>
      )}
    </main>
  );
}

function Sidebar({ activeView, onNewAnalysisClick, setView }: { activeView: View; onNewAnalysisClick: () => void; setView: (view: View) => void }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[280px] flex-col border-r border-border bg-surface-container/90 backdrop-blur-2xl px-5 py-7 lg:flex">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-primary-container to-secondary flex items-center justify-center shadow-lg shadow-primary-container/30">
            <Zap className="text-white" size={20} />
          </div>
          <div className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary font-display">
            CV Intelligence
          </div>
        </div>
        <div className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
          Enterprise RAG Console
        </div>
      </div>

      <nav className="space-y-2">
        <NavItem active={activeView === "dashboard"} icon={<BarChart3 size={20} />} label="Dashboard" onClick={() => setView("dashboard")} />
        <NavItem active={activeView === "chatbot"} icon={<MessageSquare size={20} />} label="Chatbot" onClick={() => setView("chatbot")} />
        <NavItem active={activeView === "rag"} icon={<BrainCircuit size={20} />} label="RAG CV Intelligence" onClick={() => setView("rag")} />
        <NavItem active={activeView === "processing"} icon={<Layers size={20} />} label="Processing" onClick={() => setView("processing")} />
      </nav>

      <div className="mt-auto">
        <button
          className={buttonClass("primary", "w-full h-12")}
          onClick={onNewAnalysisClick}
          type="button"
        >
          <Plus size={18} />
          New Analysis
        </button>
      </div>
    </aside>
  );
}

function TopBar({ apiStatus, model }: { apiStatus: string; model: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface-container/60 backdrop-blur-2xl px-6 py-5">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display">CV Intelligence Console</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            General chat and document intelligence in one workspace
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill label={apiStatus} />
          <StatusPill label={model} />
        </div>
      </div>
    </header>
  );
}

function Dashboard({
  apiStatus,
  chatCount,
  documentSummary,
  lastAction,
  model,
  ragCount,
  setView,
}: {
  apiStatus: string;
  chatCount: number;
  documentSummary: string;
  lastAction: string;
  model: string;
  ragCount: number;
  setView: (view: View) => void;
}) {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Server size={22} />} label="API Status" value={apiStatus} color="primary" />
        <StatCard icon={<Bot size={22} />} label="Model" value={model} color="secondary" />
        <StatCard icon={<MessageSquare size={22} />} label="Chat Turns" value={`${chatCount} / 10`} color="tertiary" />
        <StatCard icon={<BrainCircuit size={22} />} label="Document Turns" value={`${ragCount} / 10`} color="primary" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <Panel className="p-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-2">
                Workspace
              </p>
              <h2 className="text-3xl font-bold font-display">{documentSummary}</h2>
            </div>
          </div>
          <p className="text-on-surface-variant leading-relaxed mb-8">
            Ask across one profile or a full batch. Document answers include the supporting excerpts used to respond.
          </p>
          <div className="flex flex-wrap gap-4">
            <button className={buttonClass("primary")} onClick={() => setView("processing")} type="button">
              Manage CVs
            </button>
            <button className={buttonClass("secondary")} onClick={() => setView("rag")} type="button">
              Open Intelligence
            </button>
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel className="p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-4">
              Activity
            </p>
            <p className="text-sm leading-relaxed">{lastAction}</p>
          </Panel>
          <Panel className="p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-4">
              Engine
            </p>
            <p className="text-sm">SentenceTransformers + FAISS + Gemini</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ConversationPanel({
  activeHistoryCount,
  ask,
  clearHistory,
  disabled,
  eyebrow,
  isLoading,
  messages,
  placeholder,
  question,
  setQuestion,
  title,
}: {
  activeHistoryCount: number;
  ask: (event: FormEvent) => void;
  clearHistory: () => void;
  disabled: boolean;
  eyebrow: string;
  isLoading: boolean;
  messages: ChatMessage[];
  placeholder: string;
  question: string;
  setQuestion: (value: string) => void;
  title: string;
}) {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  
  const handleClearConfirm = () => {
    clearHistory();
    setShowConfirmDialog(false);
  };

  return (
    <>
      <Panel className="grid min-h-[calc(100vh-200px)] grid-rows-[auto_1fr_auto] p-0 animate-fade-in-up">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-8 py-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">{eyebrow}</p>
            <h2 className="text-2xl font-bold font-display">{title}</h2>
            <p className="text-sm text-on-surface-variant mt-1">{activeHistoryCount} of 10 recent turns retained</p>
          </div>
          <button className={buttonClass("danger", "h-10 px-4")} onClick={() => setShowConfirmDialog(true)} type="button">
            <Trash2 size={16} />
            Clear
          </button>
        </header>
        <div className="custom-scrollbar flex flex-col gap-4 overflow-y-auto p-8">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center pt-12">
              <div className="max-w-xl rounded-2xl border border-border bg-surface-container-low/90 backdrop-blur p-8 shadow-xl">
                <div className="mx-auto mb-6 h-16 w-16 rounded-3xl bg-gradient-to-br from-primary-container/30 to-secondary/30 flex items-center justify-center">
                  <BrainCircuit className="text-primary" size={36} />
                </div>
                <h3 className="text-xl font-bold font-display mb-4 text-center">{title}</h3>
                <p className="text-on-surface-variant leading-relaxed text-center">
                  {disabled ? "Add documents in Processing, then return here to ask questions." : "Ask a question to begin."}
                </p>
              </div>
            </div>
          ) : (
            messages.map((item, index) => <MessageBubble item={item} key={`${item.role}-${index}`} />)
          )}
        </div>
        <form className="grid gap-4 border-t border-border p-6 md:grid-cols-[1fr_auto]" onSubmit={ask}>
          <textarea
            className="min-h-24 resize-none rounded-2xl border border-border bg-surface-container-lowest/90 backdrop-blur p-5 text-sm outline-none transition-all placeholder:text-on-surface-variant focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading || disabled}
            placeholder={placeholder}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className={buttonClass("primary", "h-12 self-end px-7")} disabled={isLoading || disabled} type="submit">
            {isLoading ? <Loader2 className="animate-spin" size={18} /> : <SendHorizontal size={18} />}
            Send
          </button>
        </form>
      </Panel>

      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Panel className="max-w-md w-full mx-4">
            <h3 className="text-2xl font-bold font-display mb-4">Clear Conversation?</h3>
            <p className="text-on-surface-variant mb-8">This will clear all messages in this conversation. This action cannot be undone.</p>
            <div className="flex gap-4 justify-end">
              <button className={buttonClass("secondary", "h-12 px-6")} onClick={() => setShowConfirmDialog(false)} type="button">
                Cancel
              </button>
              <button className={buttonClass("danger", "h-12 px-6")} onClick={handleClearConfirm} type="button">
                Yes, Clear
              </button>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

function Processing({
  activeCvs,
  documentSummary,
  lastAction,
  removeCvs,
  startUpload,
  uploading,
}: {
  activeCvs: string[];
  documentSummary: string;
  lastAction: string;
  removeCvs: () => void;
  startUpload: () => void;
  uploading: boolean;
}) {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <Panel className="relative overflow-hidden border-dashed p-14 text-center">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary-container/10 to-secondary/8 pointer-events-none"></div>
        <div className="relative mx-auto flex max-w-2xl flex-col items-center">
          <div className="mb-8 h-24 w-24 rounded-[32px] bg-gradient-to-br from-primary-container/40 to-secondary/40 flex items-center justify-center shadow-2xl">
            {uploading ? <Loader2 className="animate-spin text-primary" size={48} /> : <UploadCloud className="text-primary" size={48} />}
          </div>
          <h2 className="text-3xl font-bold font-display mb-5">Add CV documents</h2>
          <p className="text-on-surface-variant leading-relaxed text-lg mb-10">
            Upload one file or a batch. Supported formats: PDF, TXT, and MD.
          </p>
          <div className="flex flex-wrap justify-center gap-5">
            <button className={buttonClass("primary", "h-14 px-10 text-base")} disabled={uploading} onClick={startUpload} type="button">
              Browse Files
            </button>
            {activeCvs.length ? (
              <button className={buttonClass("danger", "h-14 px-10 text-base")} onClick={removeCvs} type="button">
                Clear Documents
              </button>
            ) : null}
          </div>
        </div>
      </Panel>
      <Panel className="p-10">
        <div className="mb-8 flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-primary-container/25 flex items-center justify-center">
            <Gauge className="text-primary" size={24} />
          </div>
          <h3 className="text-2xl font-bold font-display">Document Status</h3>
        </div>
        <div className="grid gap-5">
          <QueueRow label="Documents" status={documentSummary} state={activeCvs.length ? "ready" : "waiting"} />
          <QueueRow label="Validation" status={activeCvs.length ? "Completed" : "Waiting for upload"} state={activeCvs.length ? "ready" : "waiting"} />
          <QueueRow label="Intelligence" status={activeCvs.length ? "Ready for questions" : "Waiting for documents"} state={activeCvs.length ? "ready" : "waiting"} />
          <QueueRow label="Activity" status={lastAction} state="info" />
        </div>
        {activeCvs.length ? (
          <div className="mt-10 rounded-3xl border border-border bg-surface-container-low/90 backdrop-blur p-8">
            <p className="mb-6 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Current Documents
            </p>
            <div className="grid gap-4">
              {activeCvs.map((cv) => (
                <div className="flex items-center gap-4 rounded-2xl bg-surface-container-lowest/95 backdrop-blur px-6 py-5 text-sm" key={cv}>
                  <FileText size={22} className="text-primary" />
                  <span className="font-medium truncate">{cv}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-border bg-surface-container/90 backdrop-blur-2xl p-7 shadow-2xl ${className}`}>
      {children}
    </section>
  );
}

function StatCard({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color: "primary" | "secondary" | "tertiary" }) {
  const colorClasses = {
    primary: "from-primary-container/20 to-primary/10 text-primary",
    secondary: "from-secondary/20 to-secondary/10 text-secondary",
    tertiary: "from-tertiary/20 to-tertiary/10 text-tertiary",
  };

  return (
    <Panel className="p-7 hover:shadow-2xl transition-all duration-300">
      <div className="flex items-center justify-between mb-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{label}</span>
        <div className={`h-11 w-11 rounded-2xl bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold font-display text-on-surface">{value}</div>
    </Panel>
  );
}

function QueueRow({ label, state, status }: { label: string; state: "ready" | "waiting" | "info"; status: string }) {
  const dotColors = {
    ready: "bg-primary",
    waiting: "bg-on-surface-variant/40",
    info: "bg-secondary",
  };

  return (
    <div className="grid gap-4 rounded-2xl border border-border bg-surface-container-low/60 backdrop-blur p-6 md:grid-cols-[200px_1fr]">
      <div className="flex items-center gap-3 text-sm font-semibold">
        <span className={`h-3 w-3 rounded-full ${dotColors[state]}`} />
        {label}
      </div>
      <div className="text-sm text-on-surface-variant">{status}</div>
    </div>
  );
}

function MessageBubble({ item }: { item: ChatMessage }) {
  const styles = {
    user: "ml-auto border-primary/30 bg-gradient-to-r from-primary-container/15 to-secondary/10 shadow-lg",
    assistant: "mr-auto border-border bg-surface-container-low/80 backdrop-blur shadow-md",
    system: "mx-auto border-tertiary/30 bg-gradient-to-r from-tertiary/15 to-tertiary/10 text-tertiary shadow-md",
  };

  return (
    <div className={`max-w-3xl rounded-2xl border p-6 text-sm leading-relaxed ${styles[item.role]}`}>
      <div className="whitespace-pre-wrap">{item.text}</div>
      {item.sources?.length ? (
        <div className="mt-6 space-y-3 border-t border-border pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-4">
            Supporting Excerpts
          </p>
          {item.sources.map((source) => (
            <div className="rounded-xl border border-border bg-surface-container-lowest/80 backdrop-blur p-5" key={`${source.document}-${source.document_chunk}-${source.score}`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface-variant">
                <span className="font-semibold">{source.document || "CV"} | section {source.document_chunk || source.chunk}</span>
                <span className="text-primary">{source.score}</span>
              </div>
              <p className="text-xs leading-relaxed text-on-surface-variant">{source.snippet}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={`flex h-12 items-center gap-4 rounded-2xl px-5 text-left text-sm font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
        active
          ? "bg-gradient-to-r from-primary-container/20 to-secondary/20 text-primary shadow-lg shadow-primary-container/10 border border-primary/20"
          : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-border bg-surface-container-low/80 backdrop-blur px-5 py-3 text-xs font-semibold text-on-surface-variant shadow-md">
      <span className="h-3 w-3 rounded-full bg-gradient-to-r from-primary to-secondary animate-pulse"></span>
      {label}
    </div>
  );
}

