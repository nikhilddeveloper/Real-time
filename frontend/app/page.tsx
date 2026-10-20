"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AudioSource = "microphone" | "meeting-tab";
type MeetingState = "setup" | "connecting" | "live" | "ended";
type TranscriptSegment = { text: string; isQuestion: boolean };
type ResumeUpload = { filename: string; text: string; character_count: number };
type InsightsUpdate = {
  summary: string;
  action_items: string[];
  follow_up_questions: string[];
};

const SEGMENT_MS = 4000;

export default function Home() {
  const [meetingState, setMeetingState] = useState<MeetingState>("setup");
  const [source, setSource] = useState<AudioSource>("microphone");
  const [consent, setConsent] = useState(false);
  const [title, setTitle] = useState("Team sync");
  const [context, setContext] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState("");
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [resume, setResume] = useState<ResumeUpload | null>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const [practiceAnswers, setPracticeAnswers] = useState<Record<number, string>>({});
  const [generatingAnswer, setGeneratingAnswer] = useState<number | null>(null);

  const activeRef = useRef(false);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<number | null>(null);
  const clockRef = useRef<number | null>(null);
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const analysisQueueRef = useRef<Promise<void>>(Promise.resolve());
  const summaryRef = useRef("");
  const transcriptRef = useRef<TranscriptSegment[]>([]);

  useEffect(() => { summaryRef.current = summary; }, [summary]);

  const stopCapture = useCallback(() => {
    activeRef.current = false;
    if (segmentTimerRef.current !== null) window.clearTimeout(segmentTimerRef.current);
    if (clockRef.current !== null) window.clearInterval(clockRef.current);
    segmentTimerRef.current = null;
    clockRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    captureStreamRef.current = null;
    setProcessing(false);
  }, []);

  useEffect(() => stopCapture, [stopCapture]);

  const requestInsights = useCallback(async (segments: TranscriptSegment[]) => {
    if (!segments.length) return;
    setAnalyzing(true);
    try {
      const response = await fetch("/api/meeting/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript: segments.slice(-30).map((segment) => segment.text).join("\n"),
          previous_summary: summaryRef.current,
          meeting_context: `${title}\n${context}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not update meeting insights.");
      const update = payload as InsightsUpdate;
      setSummary(update.summary);
      setActionItems(update.action_items);
      setFollowUps(update.follow_up_questions);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Meeting insights failed.");
    } finally {
      setAnalyzing(false);
    }
  }, [context, title]);

  const uploadSegment = useCallback(async (blob: Blob) => {
    if (blob.size < 1000) return;
    setProcessing(true);
    const mimeType = blob.type || "audio/webm";
    const formData = new FormData();
    formData.append("file", new File([blob], "meeting-segment.webm", { type: mimeType }));
    formData.append("previous_text", transcriptRef.current.slice(-2).map((segment) => segment.text).join(" "));
    try {
      const response = await fetch("/api/meeting/transcribe", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 422 && String(payload.detail || "").includes("No speech")) return;
      if (!response.ok) throw new Error(payload.detail || "Could not process this audio segment.");
      const text = String(payload.transcript || "").trim();
      if (text) {
        const next = [...transcriptRef.current, { text, isQuestion: Boolean(payload.is_question) }];
        transcriptRef.current = next;
        setTranscript(next);
        if (next.length % 3 === 0) {
          analysisQueueRef.current = analysisQueueRef.current.then(() => requestInsights(next));
        }
      }
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Meeting analysis failed.");
    } finally {
      setProcessing(false);
    }
  }, [requestInsights]);

  const beginSegment = useCallback((stream: MediaStream) => {
    if (!activeRef.current || !stream.active) return;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => {
      if (!activeRef.current) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      beginSegment(stream);
      uploadQueueRef.current = uploadQueueRef.current.then(() => uploadSegment(blob));
    };
    recorder.start(1000);
    segmentTimerRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, SEGMENT_MS);
  }, [uploadSegment]);

  async function startMeeting() {
    if (!consent) return;
    setMeetingState("connecting");
    setError("");
    try {
      let captureStream: MediaStream;
      if (source === "meeting-tab") {
        captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (captureStream.getAudioTracks().length === 0) {
          captureStream.getTracks().forEach((track) => track.stop());
          throw new Error("No shared audio was selected. Choose a browser tab and enable Share tab audio.");
        }
      } else {
        captureStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      }
      const audioStream = new MediaStream(captureStream.getAudioTracks());
      captureStream.getTracks().forEach((track) => {
        track.addEventListener("ended", () => { if (activeRef.current) endMeeting(); }, { once: true });
      });
      captureStreamRef.current = captureStream;
      recordingStreamRef.current = audioStream;
      activeRef.current = true;
      setElapsed(0);
      setMeetingState("live");
      clockRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000);
      beginSegment(audioStream);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "Audio permission was not granted.");
      setMeetingState("setup");
    }
  }

  function endMeeting() {
    stopCapture();
    setMeetingState("ended");
    if (transcriptRef.current.length) {
      analysisQueueRef.current = analysisQueueRef.current.then(() => requestInsights(transcriptRef.current));
    }
  }

  function resetMeeting() {
    stopCapture();
    transcriptRef.current = [];
    setTranscript([]); setSummary(""); setActionItems([]); setFollowUps([]); setPracticeAnswers({}); setElapsed(0); setError(""); setMeetingState("setup");
  }

  async function uploadResume(file: File | undefined) {
    if (!file) return;
    setResumeUploading(true);
    setResumeError("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch("/api/profile/resume", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not read this resume.");
      setResume(payload as ResumeUpload);
    } catch (uploadError) {
      setResume(null);
      setResumeError(uploadError instanceof Error ? uploadError.message : "Could not read this resume.");
    } finally {
      setResumeUploading(false);
    }
  }

  async function generatePracticeAnswer(question: string, index: number) {
    if (meetingState !== "ended" || !resume) return;
    setGeneratingAnswer(index);
    setError("");
    try {
      const response = await fetch("/api/profile/practice-answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, resume_text: resume.text, role: "Candidate" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not create a practice answer.");
      setPracticeAnswers((current) => ({ ...current, [index]: String(payload.answer || "") }));
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "Could not create a practice answer.");
    } finally {
      setGeneratingAnswer(null);
    }
  }

  function downloadTranscript() {
    const text = [`${title} — Meeting transcript`, "", ...transcript.map((segment) => `${segment.isQuestion ? "[Question] " : ""}${segment.text}`), "", "Summary", summary, "", "Action items", ...actionItems.map((item) => `- ${item}`)].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "meeting"}-notes.txt`; link.click();
    URL.revokeObjectURL(url);
  }

  const time = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  if (meetingState === "setup" || meetingState === "connecting") {
    return (
      <main className="onboarding-page">
        <header className="marketing-header">
          <Brand />
          <div className="header-trust"><span className="trust-dot" /> Consent-first AI assistance</div>
        </header>

        <section className="onboarding-layout">
          <aside className="product-story">
            <div className="story-copy">
              <span className="section-label light">MEETING INTELLIGENCE, IN REAL TIME</span>
              <h1>Stay present.<br />We&apos;ll keep track.</h1>
              <p>Follow every permitted conversation with fast captions, a living summary, clear action items, and thoughtful follow-ups.</p>
            </div>

            <div className="product-preview" aria-hidden="true">
              <div className="preview-top"><span><i /> Live conversation</span><em>04:18</em></div>
              <div className="preview-line featured"><b>Q</b><p>What should we prioritize before launch?</p></div>
              <div className="preview-line"><b>02</b><p>Finalize the checklist and confirm owners by Friday.</p></div>
              <div className="preview-insight"><span>AI SUMMARY</span><strong>Launch readiness and ownership are the main focus.</strong></div>
            </div>

            <div className="story-metrics">
              <div><strong>~4 sec</strong><span>caption segments</span></div>
              <div><strong>Live</strong><span>rolling insights</span></div>
              <div><strong>You choose</strong><span>the audio source</span></div>
            </div>
          </aside>

          <section className="setup-surface">
            <div className="setup-progress" aria-label="Setup progress">
              <span className="current"><i>1</i> Configure</span><b /><span><i>2</i> Connect</span><b /><span><i>3</i> Capture</span>
            </div>

            <form className="setup-form" onSubmit={(event) => { event.preventDefault(); void startMeeting(); }}>
              <div className="form-heading">
                <span className="section-label">NEW SESSION</span>
                <h2>Set up your meeting</h2>
                <p>Choose a permitted source and add context for more useful notes.</p>
              </div>

              <label className="field-label" htmlFor="meeting-title">Meeting title</label>
              <input id="meeting-title" className="text-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Weekly product sync" required />

              <fieldset className="source-fieldset">
                <legend>Audio source</legend>
                <button aria-pressed={source === "microphone"} className={`source-option ${source === "microphone" ? "selected" : ""}`} type="button" onClick={() => setSource("microphone")}>
                  <span className="source-icon">◉</span><span><strong>Room microphone</strong><small>Capture voices audible near this device</small></span><i>✓</i>
                </button>
                <button aria-pressed={source === "meeting-tab"} className={`source-option ${source === "meeting-tab" ? "selected" : ""}`} type="button" onClick={() => setSource("meeting-tab")}>
                  <span className="source-icon">▣</span><span><strong>Meeting tab audio</strong><small>Select a browser tab and enable Share tab audio</small></span><i>✓</i>
                </button>
              </fieldset>

              <label className="field-label" htmlFor="meeting-context">Meeting context <em>Optional</em></label>
              <textarea id="meeting-context" className="text-area" value={context} onChange={(event) => setContext(event.target.value)} placeholder="Agenda, project names, vocabulary, or desired outcomes…" />

              <div className={`resume-upload ${resume ? "has-file" : ""}`}>
                <div className="resume-copy">
                  <span className="resume-icon">CV</span>
                  <div>
                    <strong>{resume ? resume.filename : "Add your resume for post-session practice"}</strong>
                    <small>{resume ? `${resume.character_count.toLocaleString()} characters extracted · used only after the meeting` : "PDF, DOCX, or TXT · optional · not used for live answers"}</small>
                  </div>
                </div>
                <label className="resume-button" htmlFor="resume-file">{resumeUploading ? "Reading…" : resume ? "Replace" : "Upload"}</label>
                <input id="resume-file" className="visually-hidden" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={resumeUploading} onChange={(event) => void uploadResume(event.target.files?.[0])} />
              </div>
              {resumeError && <div className="resume-error" role="alert">{resumeError}</div>}

              <div className={`consent-row ${consent ? "checked" : ""}`}>
                <input id="participant-consent" aria-label="Confirm participant consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span><strong>Participant consent confirmed</strong><small>I confirm that required participants have been informed and AI assistance is permitted.</small></span>
              </div>

              {error && <div className="form-error" role="alert"><strong>Connection issue</strong><span>{error}</span></div>}

              <button className="primary-button" type="submit" disabled={!consent || meetingState === "connecting"}>
                <span>{meetingState === "connecting" ? "Connecting to audio…" : "Start live assistant"}</span><b>→</b>
              </button>
              <p className="form-footnote">Audio is processed in short segments and is not retained by this app.</p>
            </form>
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-page">
      <aside className="workspace-sidebar">
        <Brand inverse />
        <div className={`session-state ${meetingState}`}><span /><div><strong>{meetingState === "live" ? "Session live" : "Session ended"}</strong><small>AI assistance visible</small></div></div>
        <nav aria-label="Meeting workspace">
          <a className="active" href="#transcript"><span>01</span> Transcript</a>
          <a href="#summary"><span>02</span> Summary</a>
          <a href="#actions"><span>03</span> Action items</a>
          <a href="#follow-ups"><span>04</span> Follow-ups</a>
        </nav>
        <div className="source-summary"><span>AUDIO SOURCE</span><strong>{source === "meeting-tab" ? "Meeting tab" : "Room microphone"}</strong><small>Selected explicitly by you</small></div>
        <div className="sidebar-disclosure"><span>✓</span><p>Consent-based capture. No hidden recording or screen-share evasion.</p></div>
      </aside>

      <section className="workspace-content">
        <header className="workspace-header">
          <div><span className="section-label">CURRENT MEETING</span><h1>{title}</h1></div>
          <div className="header-controls">
            <div className="capture-health"><span className={meetingState === "live" ? "pulse" : ""} /><div><strong>{meetingState === "live" ? "Listening" : "Complete"}</strong><small>{processing ? "Transcribing now" : analyzing ? "Updating insights" : "All systems ready"}</small></div></div>
            <time>{time}</time>
            <button className={meetingState === "live" ? "end-button" : "new-button"} type="button" onClick={meetingState === "live" ? endMeeting : resetMeeting}>{meetingState === "live" ? "End session" : "New session"}</button>
          </div>
        </header>

        {error && <div className="workspace-error" role="alert"><strong>We hit a processing issue.</strong><span>{error}</span></div>}

        <div className="workspace-grid">
          <section className="transcript-card" id="transcript">
            <header className="card-header"><div><span className="section-label">FAST CAPTIONS</span><h2>Live transcript</h2></div><div className="caption-latency"><i /> ~4-second segments</div></header>
            <div className="transcript-scroll" aria-live="polite">
              {transcript.length ? transcript.map((segment, index) => (
                <article className={`transcript-entry ${segment.isQuestion ? "question" : ""}`} key={`${index}-${segment.text.slice(0, 12)}`}>
                  <div className="entry-index">{segment.isQuestion ? "Q" : String(index + 1).padStart(2, "0")}</div>
                  <div>{segment.isQuestion && <span className="question-tag">QUESTION DETECTED</span>}<p>{segment.text}</p></div>
                </article>
              )) : (
                <div className="transcript-empty">
                  <div className="wave-icon">{Array.from({ length: 11 }, (_, index) => <i key={index} />)}</div>
                  <strong>Ready for the conversation</strong>
                  <p>Start speaking. The first caption will appear after the opening audio segment.</p>
                  <span>Audio source: {source === "meeting-tab" ? "Meeting tab" : "Room microphone"}</span>
                </div>
              )}
            </div>
            <footer className="transcript-footer"><span>{transcript.length} segments captured</span>{processing && <strong><i /> Transcribing latest audio</strong>}</footer>
          </section>

          <aside className="intelligence-column">
            <section className="summary-panel" id="summary">
              <div className="panel-label"><span>AI</span><div><strong>Rolling summary</strong><small>{analyzing ? "Updating now…" : "Refreshes automatically"}</small></div></div>
              <h2>What matters so far</h2>
              <p>{summary || "Your meeting summary will build here as key themes emerge from the conversation."}</p>
            </section>

            <InsightList id="actions" index="01" title="Action items" empty="Commitments, owners, and next steps will appear here." items={actionItems} accent="amber" />
            <InsightList id="follow-ups" index="02" title="Suggested follow-ups" empty="Useful questions will appear as the discussion develops." items={followUps} accent="mint" />

            {meetingState === "ended" && <button className="download-button" type="button" onClick={downloadTranscript}><span>↓</span><div><strong>Download meeting notes</strong><small>Transcript, summary, and action items</small></div></button>}
          </aside>
        </div>

        {meetingState === "ended" && (
          <section className="practice-review">
            <header>
              <div><span className="section-label">AFTER-SESSION PRACTICE</span><h2>Prepare stronger answers</h2><p>Detected questions can be turned into truthful practice answers using your uploaded resume. This appears only after the live session ends.</p></div>
              <div className={`resume-status ${resume ? "ready" : ""}`}><span>{resume ? "✓" : "CV"}</span><div><strong>{resume ? "Resume ready" : "No resume uploaded"}</strong><small>{resume ? resume.filename : "Start a new session to add one"}</small></div></div>
            </header>
            {transcript.some((segment) => segment.isQuestion) ? (
              <div className="practice-question-list">
                {transcript.map((segment, index) => segment.isQuestion && (
                  <article key={`${index}-${segment.text.slice(0, 16)}`}>
                    <div className="practice-question-top"><span>QUESTION {String(index + 1).padStart(2, "0")}</span><button type="button" disabled={!resume || generatingAnswer === index} onClick={() => void generatePracticeAnswer(segment.text, index)}>{generatingAnswer === index ? "Generating…" : practiceAnswers[index] ? "Regenerate" : "Create practice answer"}</button></div>
                    <h3>{segment.text}</h3>
                    {practiceAnswers[index] && <div className="practice-answer"><span>RESUME-AWARE PRACTICE ANSWER</span><p>{practiceAnswers[index]}</p><small>Review and personalize this. Use only experience that is true for you.</small></div>}
                  </article>
                ))}
              </div>
            ) : (
              <div className="practice-empty"><strong>No complete questions were detected.</strong><p>You can still review the transcript and notes above.</p></div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <div className={`brand-lockup ${inverse ? "inverse" : ""}`}><span>ML</span><div><strong>Meeting Lens</strong><small>Real-time meeting intelligence</small></div></div>;
}

function InsightList({ id, index, title, empty, items, accent }: { id: string; index: string; title: string; empty: string; items: string[]; accent: string }) {
  return <section className={`insight-panel ${accent}`} id={id}><header><span>{index}</span><h3>{title}</h3><em>{items.length}</em></header>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="insight-empty"><i>—</i><p>{empty}</p></div>}</section>;
}
