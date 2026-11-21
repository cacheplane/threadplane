'use client';
import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  time: string;
  source: 'angular' | 'transport' | 'langgraph' | 'signal';
  message: string;
}

const SCENARIO: { delay: number; chatBubble?: { role: 'user' | 'assistant'; text: string; streaming?: boolean }; log: LogEntry }[] = [
  { delay: 0, chatBubble: { role: 'user', text: 'How do Angular Signals work with streaming?' }, log: { time: '0.00s', source: 'angular', message: 'chat.submit(userText)' } },
  { delay: 800, log: { time: '0.02s', source: 'transport', message: 'POST /threads/t_8f3a/runs/stream → 200' } },
  { delay: 1200, log: { time: '0.04s', source: 'langgraph', message: 'Executing node: call_model (gpt-5-mini)' } },
  { delay: 2200, log: { time: '0.82s', source: 'langgraph', message: 'SSE event: { type: "values", messages: [...] }' } },
  { delay: 2600, log: { time: '0.84s', source: 'transport', message: 'Received chunk → session publishes a snapshot' } },
  { delay: 2800, log: { time: '0.85s', source: 'signal', message: 'messages() updated → 2 messages' } },
  { delay: 3000, chatBubble: { role: 'assistant', text: 'Angular Signals', streaming: true }, log: { time: '0.86s', source: 'signal', message: 'status() → "running"' } },
  { delay: 3400, chatBubble: { role: 'assistant', text: 'Angular Signals provide a synchronous', streaming: true }, log: { time: '1.12s', source: 'transport', message: 'Received chunk → values event' } },
  { delay: 3900, chatBubble: { role: 'assistant', text: 'Angular Signals provide a synchronous, reactive way to', streaming: true }, log: { time: '1.45s', source: 'signal', message: 'messages() updated → streaming token' } },
  { delay: 4500, chatBubble: { role: 'assistant', text: 'Angular Signals provide a synchronous, reactive way to track streaming state.', streaming: true }, log: { time: '1.82s', source: 'langgraph', message: 'SSE event: { type: "values", status: "done" }' } },
  { delay: 5200, chatBubble: { role: 'assistant', text: 'Angular Signals provide a synchronous, reactive way to track streaming state. Each token updates the Signal, and OnPush change detection re-renders automatically.' }, log: { time: '2.10s', source: 'signal', message: 'status() → "idle" ✓' } },
  { delay: 6000, log: { time: '2.12s', source: 'angular', message: 'Template re-rendered (OnPush) — 1 component' } },
];

const SOURCE_LABEL: Record<string, string> = {
  angular: 'ANGULAR',
  transport: 'TRANSPORT',
  langgraph: 'LANGGRAPH',
  signal: 'SIGNAL',
};

export function ArchFlowDiagram() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [bubbles, setBubbles] = useState<{ role: 'user' | 'assistant'; text: string; streaming?: boolean }[]>([]);
  const [cycle, setCycle] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    const runScenario = () => {
      setLogs([]);
      setBubbles([]);

      SCENARIO.forEach((step) => {
        timeouts.push(setTimeout(() => {
          setLogs(prev => [...prev, step.log]);
          if (step.chatBubble) {
            const bubble = step.chatBubble;
            setBubbles(prev => {
              const existing = prev.findIndex(b => b.role === bubble.role && b.role === 'assistant');
              if (existing >= 0 && bubble.role === 'assistant') {
                const updated = [...prev];
                updated[existing] = bubble;
                return updated;
              }
              return [...prev, bubble];
            });
          }
          if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        }, step.delay));
      });

      // Restart after completion
      timeouts.push(setTimeout(() => {
        setCycle(c => c + 1);
      }, 8000));
    };

    runScenario();
    return () => timeouts.forEach(clearTimeout);
  }, [cycle]);

  return (
    <div className="arch-flow-card">
      {/* Header bar */}
      <div className="arch-flow-header">
        <div className="arch-flow-dots">
          <div className="arch-flow-dot arch-flow-dot--red" />
          <div className="arch-flow-dot arch-flow-dot--yellow" />
          <div className="arch-flow-dot arch-flow-dot--green" />
        </div>
        <span className="arch-flow-label">injectAgent() — live architecture flow</span>
        <span className="arch-flow-url-badge">localhost:4200</span>
      </div>

      <div className="arch-flow-body">
        {/* Left: Chat simulation */}
        <div className="arch-flow-chat-panel">
          <div className="arch-flow-panel-title">Chat Interface</div>

          <div className="arch-flow-bubbles">
            {bubbles.map((b, i) => (
              <div key={`${b.role}-${i}`} className="arch-flow-bubble-row" data-role={b.role}>
                {b.role === 'assistant' && (
                  <div className="arch-flow-avatar">AI</div>
                )}
                <div className="arch-flow-bubble" data-role={b.role}>
                  {b.text}
                  {b.streaming && <span className="arch-flow-cursor">▊</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Console log */}
        <div ref={logRef} className="arch-flow-console-panel">
          <div className="arch-flow-console-title">Developer Console</div>

          {logs.map((log, i) => (
            <div key={i} className="arch-flow-log-row">
              <span className="arch-flow-log-time">{log.time}</span>
              <span className="arch-flow-log-source" data-source={log.source}>{SOURCE_LABEL[log.source]}</span>
              <span className="arch-flow-log-message">{log.message}</span>
            </div>
          ))}

          {logs.length === 0 && (
            <div className="arch-flow-log-empty">Waiting for interaction...</div>
          )}
        </div>
      </div>
    </div>
  );
}
