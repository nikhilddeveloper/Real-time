"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AudioSource = "microphone" | "meeting-tab";
type MeetingState = "setup" | "connecting" | "live" | "ended";
type TranscriptSegment = { text: string; isQuestion: boolean };
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
    setTranscript([]); setSummary(""); setActionItems([]); setFollowUps([]); setElapsed(0); setError(""); setMeetingState("setup");
  }

  function downloadTranscript() {
    const text = [`${title} — Meeting transcript`, "", ...transcript.map((segment) => `${segment.isQuestion ? "[Question] " : ""}${segment.text}`), "", "Summary", summary, "", "Action items", ...actionItems.map((item) => `- ${item}`)].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "meeting"}-notes.txt`; link.click();
    URL.revokeObjectURL(url);
  }

  const time = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <main className="meeting-app">
      <header className="app-header">
        <div className="brand"><span>M</span><div><strong>Meeting Lens</strong><small>Real-time AI meeting assistant</small></div></div>
        <div className={`privacy-badge ${meetingState === "live" ? "live" : ""}`}><i />{meetingState === "live" ? "AI assistance active · visible" : "Consent-based assistance"}</div>
      </header>

      {meetingState === "setup" || meetingState === "connecting" ? (
        <section className="setup-page">
          <div className="setup-intro"><span className="eyebrow">REAL-TIME MEETING INTELLIGENCE</span><h1>Listen less.<br />Understand more.</h1><p>Capture a permitted meeting, follow the live transcript, and leave with a clear summary, action items, and better follow-up questions.</p><div className="feature-row"><span>Live transcript</span><span>Rolling summary</span><span>Action items</span></div></div>
          <form className="setup-card" onSubmit={(event) => { event.preventDefault(); void startMeeting(); }}>
            <div className="card-heading"><span>01</span><div><h2>Start a meeting</h2><p>Choose exactly what the assistant may hear.</p></div></div>
            <label>Meeting title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Weekly team sync" required /></label>
            <fieldset><legend>Audio source</legend><button className={source === "microphone" ? "selected" : ""} type="button" onClick={() => setSource("microphone")}><strong>Microphone</strong><small>Voices audible near this device</small></button><button className={source === "meeting-tab" ? "selected" : ""} type="button" onClick={() => setSource("meeting-tab")}><strong>Shared meeting tab</strong><small>You select a tab and enable its audio</small></button></fieldset>
            <label>Meeting context (optional)<textarea value={context} onChange={(event) => setContext(event.target.value)} placeholder="Agenda, project names, vocabulary, or desired outcomes…" /></label>
            <label className="consent-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I confirm all required participants have been informed and this AI assistance is permitted.</span></label>
            <button className="start-button" type="submit" disabled={!consent || meetingState === "connecting"}>{meetingState === "connecting" ? "Connecting…" : "Start live assistant"}</button>
            {error && <div className="error-box" role="alert">{error}</div>}
          </form>
        </section>
      ) : (
        <section className="live-page">
          <div className="meeting-bar"><div><span className="active-pulse" /><div><strong>{title}</strong><small>{source === "meeting-tab" ? "Shared meeting-tab audio" : "Microphone audio"}</small></div></div><div className="meeting-controls"><span>{time}</span>{processing && <em>Transcribing…</em>}{analyzing && <em>Updating insights…</em>}<button type="button" onClick={meetingState === "live" ? endMeeting : resetMeeting}>{meetingState === "live" ? "End meeting" : "New meeting"}</button></div></div>
          {error && <div className="error-box wide" role="alert">{error}</div>}
          <div className="meeting-grid">
            <section className="transcript-panel"><header><div><span>LIVE TRANSCRIPT · FAST CAPTIONS</span><h2>Conversation</h2></div><div className={`listening-status ${meetingState}`}><i />{meetingState === "live" ? "Listening" : "Ended"}</div></header><div className="transcript-feed">{transcript.length ? transcript.map((segment, index) => <article className={segment.isQuestion ? "question-segment" : ""} key={`${index}-${segment.text.slice(0, 12)}`}><span>{segment.isQuestion ? "Q" : String(index + 1).padStart(2, "0")}</span><div>{segment.isQuestion && <em>QUESTION DETECTED</em>}<p>{segment.text}</p></div></article>) : <div className="waiting-state"><div className="sound-bars">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</div><strong>Waiting for conversation</strong><p>Captions are submitted in approximately four-second segments.</p></div>}</div></section>
            <aside className="insight-column"><section className="summary-card"><span>ROLLING SUMMARY</span><h2>What matters so far</h2><p>{summary || "The summary will build automatically as the conversation develops."}</p></section><InsightList title="Action items" empty="No action items detected yet." items={actionItems} accent="coral" /><InsightList title="Suggested follow-ups" empty="Relevant follow-up questions will appear here." items={followUps} accent="green" />{meetingState === "ended" && <button className="download-button" type="button" onClick={downloadTranscript}>Download transcript & notes</button>}</aside>
          </div>
          <footer className="disclosure"><strong>AI assistance is active and visible.</strong><span>This app does not hide from screen sharing, capture audio without your selection, or generate interview answers.</span></footer>
        </section>
      )}
    </main>
  );
}

function InsightList({ title, empty, items, accent }: { title: string; empty: string; items: string[]; accent: string }) {
  return <section className={`insight-card ${accent}`}><h3>{title}</h3>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{empty}</p>}</section>;
}
