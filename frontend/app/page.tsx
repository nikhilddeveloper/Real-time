"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CoachResult = { question: string; answer: string; word_count: number };
type SessionNotes = { summary: string; strengths: string[]; improvements: string[]; next_steps: string[] };
type SessionState = "idle" | "listening" | "hearing" | "processing" | "answering" | "error";
type WorkspaceTab = "coach" | "questions" | "transcript" | "notes" | "context";

const SILENCE_TO_SUBMIT_MS = 1400;
const MAX_QUESTION_MS = 30000;
const EMPTY_CYCLE_MS = 20000;
const QUESTION_BANK = [
  { category: "Python", question: "How do you structure a production Python project?" },
  { category: "Python", question: "Explain decorators and give a practical use case." },
  { category: "Backend", question: "How would you design a scalable REST API?" },
  { category: "System design", question: "How would you design a URL shortening service?" },
  { category: "Behavioral", question: "Tell me about a difficult technical problem you solved." },
  { category: "Behavioral", question: "Describe a disagreement with a teammate and how you handled it." },
];

export default function Home() {
  const [tab, setTab] = useState<WorkspaceTab>("coach");
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [result, setResult] = useState<CoachResult | null>(null);
  const [turns, setTurns] = useState<CoachResult[]>([]);
  const [notes, setNotes] = useState<SessionNotes | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState("Python Backend Developer");
  const [company, setCompany] = useState("");
  const [instructions, setInstructions] = useState("");
  const [answerStyle, setAnswerStyle] = useState("concise");
  const sessionActiveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const animationRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const beginCaptureCycleRef = useRef<(stream: MediaStream) => void>(() => undefined);
  const heardSpeechRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const cycleStartedAtRef = useRef(0);
  const noiseFloorRef = useRef(0.004);
  const speechFramesRef = useRef(0);

  const stopAudioResources = useCallback(() => {
    sessionActiveRef.current = false;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
  }, []);

  useEffect(() => stopAudioResources, [stopAudioResources]);

  const acceptResult = useCallback((payload: CoachResult) => {
    setResult(payload);
    setTurns((current) => [...current, payload]);
    setNotes(null);
    setSessionState("answering");
    setTab("coach");
  }, []);

  const sendQuestion = useCallback(async (blob: Blob) => {
    stopAudioResources();
    setSessionState("processing");
    setError("");
    const mimeType = blob.type || "audio/webm";
    const extension = mimeType.includes("ogg") ? "ogg" : "webm";
    const formData = new FormData();
    formData.append("file", new File([blob], `practice-question.${extension}`, { type: mimeType }));
    formData.append("role", role);
    formData.append("company", company);
    formData.append("instructions", instructions);
    formData.append("answer_style", answerStyle);
    try {
      const response = await fetch("/api/coach", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "The coach could not process this question.");
      acceptResult(payload as CoachResult);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not connect to the coaching service.");
      setSessionState("error");
    }
  }, [acceptResult, answerStyle, company, instructions, role, stopAudioResources]);

  const practiceQuestion = useCallback(async (question: string) => {
    stopAudioResources();
    setSessionState("processing");
    setError("");
    setTab("coach");
    try {
      const response = await fetch("/api/coach/text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, role, company, instructions, answer_style: answerStyle }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "The coach could not process this question.");
      acceptResult(payload as CoachResult);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not connect to the coaching service.");
      setSessionState("error");
    }
  }, [acceptResult, answerStyle, company, instructions, role, stopAudioResources]);

  const beginCaptureCycle = useCallback((stream: MediaStream) => {
    if (!sessionActiveRef.current || !analyserRef.current) return;
    const recorder = new MediaRecorder(stream);
    const analyser = analyserRef.current;
    const samples = new Uint8Array(analyser.fftSize);
    chunksRef.current = [];
    heardSpeechRef.current = false;
    lastSpeechAtRef.current = 0;
    cycleStartedAtRef.current = performance.now();
    noiseFloorRef.current = 0.004;
    speechFramesRef.current = 0;
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
    recorder.onstop = () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      if (heardSpeechRef.current && blob.size > 0) void sendQuestion(blob);
      else if (sessionActiveRef.current && stream.active) beginCaptureCycleRef.current(stream);
    };
    recorder.start(250);
    setSessionState("listening");
    const monitor = () => {
      if (!sessionActiveRef.current || recorder.state !== "recording") return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) { const normalized = (sample - 128) / 128; energy += normalized * normalized; }
      const rms = Math.sqrt(energy / samples.length);
      const now = performance.now();
      const elapsed = now - cycleStartedAtRef.current;
      if (!heardSpeechRef.current && elapsed < 1200) noiseFloorRef.current = noiseFloorRef.current * 0.9 + rms * 0.1;
      const speechThreshold = Math.max(0.006, noiseFloorRef.current * 2.2);
      if (rms > speechThreshold) {
        speechFramesRef.current += 1;
        if (speechFramesRef.current >= 5) heardSpeechRef.current = true;
        lastSpeechAtRef.current = now;
        setSessionState("hearing");
      } else if (heardSpeechRef.current) {
        speechFramesRef.current = 0;
        setSessionState("listening");
        if (now - lastSpeechAtRef.current >= SILENCE_TO_SUBMIT_MS) { recorder.stop(); return; }
      }
      if (elapsed >= MAX_QUESTION_MS || (!heardSpeechRef.current && elapsed >= EMPTY_CYCLE_MS)) { recorder.stop(); return; }
      animationRef.current = requestAnimationFrame(monitor);
    };
    animationRef.current = requestAnimationFrame(monitor);
  }, [sendQuestion]);

  useEffect(() => { beginCaptureCycleRef.current = beginCaptureCycle; }, [beginCaptureCycle]);

  async function startListening() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) { setError("Microphone listening is not supported in this browser."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.25;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sessionActiveRef.current = true;
      beginCaptureCycle(stream);
    } catch { setError("Microphone access was blocked. Allow microphone access and try again."); setSessionState("error"); }
  }

  async function generateNotes() {
    setNotesLoading(true);
    setError("");
    try {
      const response = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, company, turns }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not generate notes.");
      setNotes(payload as SessionNotes);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Could not generate notes."); }
    finally { setNotesLoading(false); }
  }

  function newSession() {
    stopAudioResources();
    setTurns([]); setResult(null); setNotes(null); setError(""); setSessionState("idle"); setTab("coach");
  }

  const isActive = ["listening", "hearing", "processing"].includes(sessionState);
  const statusCopy = { idle: "Ready for a practice question", listening: "Listening for the question", hearing: "Question detected…", processing: "Preparing your practice answer…", answering: "Your turn to practice", error: "Practice paused" }[sessionState];
  const tabs: { id: WorkspaceTab; label: string; count?: number }[] = [
    { id: "coach", label: "Practice room" }, { id: "questions", label: "Question bank", count: QUESTION_BANK.length }, { id: "transcript", label: "Transcript", count: turns.length }, { id: "notes", label: "AI notes" }, { id: "context", label: "Role & context" },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="workspace-brand"><span>P</span><div><strong>Practice Room</strong><small>AI interview preparation</small></div></div>
        <button className="new-session" type="button" onClick={newSession}>＋ New practice session</button>
        <nav aria-label="Workspace">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} type="button" onClick={() => setTab(item.id)}><span>{item.label}</span>{item.count !== undefined && <em>{item.count}</em>}</button>)}</nav>
        <div className="responsible-card"><strong>Practice mode</strong><p>Built for mock interviews and disclosed coaching. Microphone access is visible and controlled by you.</p></div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-topbar"><div><span className="live-dot" /> Mock session</div><div className="session-meta"><strong>{role || "General interview"}</strong>{company && <span> · {company}</span>}</div></header>

        {tab === "coach" && <div className="panel-page">
          <div className="page-heading"><div><span className="overline">LIVE PRACTICE COACH</span><h1>Turn questions into stronger answers.</h1><p>Speak one mock question. The microphone switches off before your practice response appears.</p></div><div className="session-count"><strong>{turns.length}</strong><span>questions practiced</span></div></div>
          <section className={`coach-console ${isActive ? "active" : ""}`}>
            <div className="console-copy"><span className="status-tag">{sessionState === "answering" ? "MICROPHONE OFF" : "VOICE INPUT"}</span><h2>{statusCopy}</h2><p>{sessionState === "answering" ? "Say the suggested answer in your own words. When finished, choose the next question." : sessionState === "processing" ? "Transcribing the question and building a role-aware response." : "Ask a practice question near this device. A short silence submits it automatically."}</p></div>
            <div className={`audio-orb ${sessionState}`}><span className="mic-icon" /><i /><i /></div>
            <div className="wave-row">{Array.from({ length: 25 }, (_, index) => <span key={index} />)}</div>
            <div className="console-actions">{!isActive ? <button className="primary-action" type="button" onClick={() => void startListening()}>{turns.length ? "Listen for next question" : "Start voice practice"}</button> : <button className="secondary-action" type="button" onClick={() => { stopAudioResources(); setSessionState("idle"); }}>Stop listening</button>}<small>{sessionState === "answering" ? "Your answer is not being recorded." : "Browser microphone only · no meeting or system audio"}</small></div>
            {error && <div className="inline-error" role="alert"><strong>Couldn’t complete that.</strong> {error}</div>}
          </section>
          {result ? <section className="answer-grid" aria-live="polite"><article className="question-panel"><span>QUESTION {turns.length}</span><p>{result.question}</p></article><article className="answer-panel"><div><span>PRACTICE ANSWER</span><em>{result.word_count} words</em></div><blockquote>{result.answer}</blockquote><small>Personalize this with your real experience—never claim work you did not do.</small></article></section> : <section className="empty-answer"><span>Q → A</span><div><strong>Your role-aware answer will appear here</strong><p>Or choose a question from the Question bank to begin without audio.</p></div><button type="button" onClick={() => setTab("questions")}>Browse questions</button></section>}
        </div>}

        {tab === "questions" && <div className="panel-page"><PageHeading overline="QUESTION BANK" title="Practice what comes up most." copy="Choose a realistic prompt and get a concise answer shaped by your role and notes." /><div className="question-list">{QUESTION_BANK.map((item, index) => <article key={item.question}><div><span>{item.category}</span><em>0{index + 1}</em></div><h3>{item.question}</h3><button type="button" onClick={() => void practiceQuestion(item.question)}>Practice this question →</button></article>)}</div></div>}

        {tab === "transcript" && <div className="panel-page"><PageHeading overline="SESSION TRANSCRIPT" title="Your practice history." copy="Questions and suggested answers from this browser session." />{turns.length ? <div className="transcript-list">{turns.map((turn, index) => <article key={`${turn.question}-${index}`}><header><span>{String(index + 1).padStart(2, "0")}</span><strong>{turn.question}</strong></header><p>{turn.answer}</p></article>)}</div> : <BlankState title="No questions yet" copy="Start in the Practice room or select a Question bank prompt." />}</div>}

        {tab === "notes" && <div className="panel-page"><div className="page-heading compact"><div><span className="overline">AI COACHING NOTES</span><h1>Review, improve, repeat.</h1><p>Turn this session into a focused preparation plan.</p></div>{turns.length > 0 && <button className="primary-action small" type="button" disabled={notesLoading} onClick={() => void generateNotes()}>{notesLoading ? "Generating…" : notes ? "Refresh notes" : "Generate notes"}</button>}</div>{error && <div className="inline-error" role="alert">{error}</div>}{notes ? <div className="notes-layout"><article className="summary-note"><span>SUMMARY</span><p>{notes.summary}</p></article><NoteList title="Strengths to keep" items={notes.strengths} /><NoteList title="Areas to improve" items={notes.improvements} /><NoteList title="Next practice steps" items={notes.next_steps} /></div> : <BlankState title={turns.length ? "Notes are ready to generate" : "Complete a practice question first"} copy="We’ll summarize themes, strengths, improvements, and next steps." />}</div>}

        {tab === "context" && <div className="panel-page narrow"><PageHeading overline="ROLE & CONTEXT" title="Make every answer relevant." copy="Add only truthful background. This information guides future practice answers." /><form className="context-form" onSubmit={(event) => { event.preventDefault(); setTab("coach"); }}><label>Target role<input value={role} onChange={(event) => setRole(event.target.value)} placeholder="e.g. Python Backend Developer" /></label><label>Company (optional)<input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="e.g. Acme" /></label><label>Answer style<select value={answerStyle} onChange={(event) => setAnswerStyle(event.target.value)}><option value="concise">Concise and direct</option><option value="star">STAR structure</option><option value="technical">Technical and detailed</option><option value="conversational">Conversational</option></select></label><label>Resume notes, job description, or instructions<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={6000} placeholder="Paste relevant, truthful experience and the job requirements…" /><small>{instructions.length} / 6000 characters</small></label><button className="primary-action" type="submit">Save context & return</button></form></div>}
      </section>
    </main>
  );
}

function PageHeading({ overline, title, copy }: { overline: string; title: string; copy: string }) { return <div className="page-heading compact"><div><span className="overline">{overline}</span><h1>{title}</h1><p>{copy}</p></div></div>; }
function BlankState({ title, copy }: { title: string; copy: string }) { return <div className="blank-state"><strong>{title}</strong><p>{copy}</p></div>; }
function NoteList({ title, items }: { title: string; items: string[] }) { return <article className="note-list"><h3>{title}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></article>; }
