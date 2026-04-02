'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DemoEvent,
  ElementName,
  ElementStatus,
  ELEMENTS,
  ISAIAH_DEMO_EVENTS,
} from '@/lib/isaiah-demo-session';

/* ─── State types ─────────────────────────────────────────────────────── */

type TranscriptLine = { speaker: 'justice' | 'plaintiff'; text: string };

type ElementState = {
  status: ElementStatus;
  reasoning: string;
};

type StatutePill = {
  statute: string;
  label: string;
  color: string;
};

type DocumentItem = {
  name: string;
  icon: string;
};

type EconomicPitch = {
  headline: string;
  summary: string;
  estimatedRange: string;
  statutes: string[];
  elements: string;
  documents: number;
  viability: number;
};

type CallState =
  | 'idle'
  | 'connecting'
  | 'call_1_active'
  | 'call_1_complete'
  | 'packaging'
  | 'complete';

const CALL_STEPS: { key: CallState; label: string }[] = [
  { key: 'connecting', label: 'Connecting' },
  { key: 'call_1_active', label: 'Call Active' },
  { key: 'call_1_complete', label: 'Call Complete' },
  { key: 'packaging', label: 'Packaging' },
  { key: 'complete', label: 'Complete' },
];

function stepIndex(state: CallState): number {
  const idx = CALL_STEPS.findIndex((s) => s.key === state);
  return idx === -1 ? -1 : idx;
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ─── Component ───────────────────────────────────────────────────────── */

export default function DemoPage() {
  /* playback state */
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [eventIndex, setEventIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStarted = useRef(false);

  /* domain state */
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [elements, setElements] = useState<Record<ElementName, ElementState>>(
    () => {
      const init: Record<string, ElementState> = {};
      for (const el of ELEMENTS) {
        init[el] = { status: 'pending', reasoning: '' };
      }
      return init as Record<ElementName, ElementState>;
    },
  );
  const [changedElement, setChangedElement] = useState<string | null>(null);
  const [statutes, setStatutes] = useState<StatutePill[]>([]);
  const [viability, setViability] = useState(0);
  const [viabilityTier, setViabilityTier] = useState('Pending');
  const [callState, setCallState] = useState<CallState>('idle');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [economicPitch, setEconomicPitch] = useState<EconomicPitch | null>(
    null,
  );

  /* animated viability display */
  const [displayViability, setDisplayViability] = useState(0);
  const animFrameRef = useRef<number | null>(null);

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  /* ── Auto-scroll transcript ─────────────────────────────────────── */
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  /* ── Animate viability number ───────────────────────────────────── */
  useEffect(() => {
    const target = viability;
    const start = displayViability;
    if (start === target) return;

    const duration = 600; // ms
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayViability(Math.round(start + (target - start) * eased));
      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viability]);

  /* ── Process a single event ─────────────────────────────────────── */
  const processEvent = useCallback((ev: DemoEvent) => {
    switch (ev.type) {
      case 'transcript':
        setTranscript((prev) => [
          ...prev,
          { speaker: ev.data.speaker, text: ev.data.text },
        ]);
        break;
      case 'element_update':
        setElements((prev) => ({
          ...prev,
          [ev.data.element]: {
            status: ev.data.status,
            reasoning: ev.data.reasoning,
          },
        }));
        setChangedElement(ev.data.element);
        setTimeout(() => setChangedElement(null), 1200);
        break;
      case 'statute_trigger':
        setStatutes((prev) => {
          if (prev.find((s) => s.statute === ev.data.statute)) return prev;
          return [
            ...prev,
            {
              statute: ev.data.statute,
              label: ev.data.label,
              color: ev.data.color,
            },
          ];
        });
        break;
      case 'viability_update':
        setViability(ev.data.score);
        setViabilityTier(ev.data.tier);
        break;
      case 'call_state':
        setCallState(ev.data.state);
        break;
      case 'document_received':
        setDocuments((prev) => [
          ...prev,
          { name: ev.data.name, icon: ev.data.icon },
        ]);
        break;
      case 'economic_pitch':
        setEconomicPitch(ev.data as EconomicPitch);
        break;
    }
  }, []);

  /* ── Schedule the next event ────────────────────────────────────── */
  const scheduleNext = useCallback(
    (idx: number) => {
      if (idx >= ISAIAH_DEMO_EVENTS.length) {
        setPlaying(false);
        return;
      }
      const ev = ISAIAH_DEMO_EVENTS[idx];
      const prevTs =
        idx > 0 ? ISAIAH_DEMO_EVENTS[idx - 1].timestamp : 0;
      const delay = (ev.timestamp - prevTs) / speed;

      timeoutRef.current = setTimeout(() => {
        processEvent(ev);
        setElapsedMs(ev.timestamp);
        setEventIndex(idx + 1);
      }, Math.max(delay, 0));
    },
    [speed, processEvent],
  );

  /* ── React to eventIndex / playing changes ──────────────────────── */
  useEffect(() => {
    if (!playing) return;
    scheduleNext(eventIndex);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [eventIndex, playing, scheduleNext]);

  /* ── Elapsed timer (cosmetic) ───────────────────────────────────── */
  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => {
        setElapsedMs((prev) => prev + 100 * speed);
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, speed]);

  /* ── Auto-play on mount ─────────────────────────────────────────── */
  useEffect(() => {
    if (!autoStarted.current) {
      autoStarted.current = true;
      setPlaying(true);
    }
  }, []);

  /* ── Controls ───────────────────────────────────────────────────── */
  const togglePlay = () => setPlaying((p) => !p);

  const restart = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setPlaying(false);
    setEventIndex(0);
    setElapsedMs(0);
    setTranscript([]);
    setElements(() => {
      const init: Record<string, ElementState> = {};
      for (const el of ELEMENTS) init[el] = { status: 'pending', reasoning: '' };
      return init as Record<ElementName, ElementState>;
    });
    setChangedElement(null);
    setStatutes([]);
    setViability(0);
    setDisplayViability(0);
    setViabilityTier('Pending');
    setCallState('idle');
    setDocuments([]);
    setEconomicPitch(null);
    // start again after a beat
    setTimeout(() => setPlaying(true), 300);
  };

  /* ── Viability color ────────────────────────────────────────────── */
  const viabilityColor =
    displayViability >= 80
      ? 'text-green-400'
      : displayViability >= 50
        ? 'text-yellow-400'
        : displayViability > 0
          ? 'text-orange-400'
          : 'text-gray-500';

  const tierBadgeColor =
    viabilityTier === 'Exceptional'
      ? 'bg-green-500/20 text-green-400 border-green-500/30'
      : viabilityTier === 'Strong'
        ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
        : viabilityTier === 'Viable'
          ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
          : 'bg-gray-500/20 text-gray-500 border-gray-500/30';

  /* ── Call-state badge ───────────────────────────────────────────── */
  const callBadgeColor =
    callState === 'call_1_active'
      ? 'bg-green-500/20 text-green-400 border-green-500/40'
      : callState === 'complete'
        ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
        : callState === 'packaging'
          ? 'bg-purple-500/20 text-purple-400 border-purple-500/40'
          : 'bg-gray-700/40 text-gray-400 border-gray-600/40';

  const callBadgeLabel =
    CALL_STEPS.find((s) => s.key === callState)?.label ?? 'Idle';

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden"
      style={{ backgroundColor: '#0a0a0f' }}
    >
      {/* ── Top Bar ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800/60">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold tracking-widest uppercase text-gray-300">
            Wolf Law{' '}
            <span className="text-blue-400 ml-1">Justice Live</span>
          </h1>
          <span
            className={`text-xs px-2.5 py-1 rounded-full border font-medium ${callBadgeColor}`}
          >
            {callState === 'call_1_active' && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5 animate-pulse" />
            )}
            {callBadgeLabel}
          </span>
        </div>
        <span className="font-mono text-sm text-gray-500">
          {formatTime(elapsedMs)}
        </span>
      </header>

      {/* ── Main area ───────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left: Transcript ─────────────────────────────────── */}
        <div className="w-[60%] flex flex-col border-r border-gray-800/40">
          <div className="px-5 py-3 border-b border-gray-800/40">
            <h2 className="text-xs font-semibold tracking-widest uppercase text-gray-500">
              Live Transcript
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {transcript.map((line, i) => (
              <div
                key={i}
                className={`flex ${line.speaker === 'justice' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm font-mono leading-relaxed ${
                    line.speaker === 'justice'
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'bg-gray-800/60 text-white border border-gray-700/40'
                  }`}
                  style={{ animationName: 'fadeSlideIn', animationDuration: '0.3s', animationFillMode: 'both' }}
                >
                  <span className="block text-[10px] uppercase tracking-wider mb-1 opacity-50">
                    {line.speaker === 'justice' ? 'Justice' : 'Isaiah Thompson'}
                  </span>
                  {line.text}
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* ── Right: Analysis ──────────────────────────────────── */}
        <div className="w-[40%] flex flex-col overflow-y-auto">
          <div className="px-5 py-3 border-b border-gray-800/40">
            <h2 className="text-xs font-semibold tracking-widest uppercase text-gray-500">
              Case Analysis
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* ── Element Cards ──────────────────────────────── */}
            <div className="space-y-2">
              {ELEMENTS.map((el) => {
                const state = elements[el];
                const isChanged = changedElement === el;
                return (
                  <div
                    key={el}
                    className={`rounded-lg border px-4 py-3 transition-all duration-300 ${
                      state.status === 'true'
                        ? 'bg-green-500/5 border-green-500/20'
                        : state.status === 'partial'
                          ? 'bg-yellow-500/5 border-yellow-500/20'
                          : state.status === 'false'
                            ? 'bg-red-500/5 border-red-500/20'
                            : 'bg-gray-900/40 border-gray-800/40'
                    } ${isChanged ? 'ring-2 ring-green-400/40' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-200">
                        {el}
                      </span>
                      <StatusBadge
                        status={state.status}
                        pulse={isChanged}
                      />
                    </div>
                    {state.reasoning && (
                      <p className="text-xs text-gray-400 leading-relaxed">
                        {state.reasoning}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Statutes ───────────────────────────────────── */}
            {statutes.length > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold tracking-widest uppercase text-gray-500 mb-2">
                  Triggered Statutes
                </h3>
                <div className="flex flex-wrap gap-2">
                  {statutes.map((s) => (
                    <span
                      key={s.statute}
                      className="text-xs font-medium px-2.5 py-1 rounded-full border"
                      style={{
                        backgroundColor: `${s.color}15`,
                        color: s.color,
                        borderColor: `${s.color}30`,
                      }}
                    >
                      {s.statute}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Documents ──────────────────────────────────── */}
            {documents.length > 0 && (
              <div>
                <h3 className="text-[10px] font-semibold tracking-widest uppercase text-gray-500 mb-2">
                  Documents Received ({documents.length})
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {documents.map((d, i) => (
                    <div
                      key={i}
                      className="text-xs bg-gray-800/40 border border-gray-700/30 rounded px-3 py-2 text-gray-300"
                      style={{ animationName: 'fadeSlideIn', animationDuration: '0.3s', animationFillMode: 'both' }}
                    >
                      {d.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Viability Score ────────────────────────────── */}
            <div className="rounded-xl border border-gray-800/40 bg-gray-900/30 p-5 text-center">
              <h3 className="text-[10px] font-semibold tracking-widest uppercase text-gray-500 mb-3">
                Viability Score
              </h3>
              <div className={`text-6xl font-bold tabular-nums ${viabilityColor}`}>
                {displayViability}
              </div>
              <span
                className={`inline-block mt-2 text-xs px-3 py-1 rounded-full border font-medium ${tierBadgeColor}`}
              >
                {viabilityTier}
              </span>
            </div>

            {/* ── Economic Pitch ─────────────────────────────── */}
            {economicPitch && (
              <div
                className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5 space-y-3"
                style={{ animationName: 'fadeSlideIn', animationDuration: '0.5s', animationFillMode: 'both' }}
              >
                <h3 className="text-sm font-bold text-blue-400">
                  {economicPitch.headline}
                </h3>
                <p className="text-xs text-gray-300 leading-relaxed">
                  {economicPitch.summary}
                </p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-gray-900/50 rounded-lg p-3">
                    <span className="block text-gray-500 mb-1">
                      Est. Recovery
                    </span>
                    <span className="text-green-400 font-bold text-sm">
                      {economicPitch.estimatedRange}
                    </span>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-3">
                    <span className="block text-gray-500 mb-1">Elements</span>
                    <span className="text-white font-bold text-sm">
                      {economicPitch.elements}
                    </span>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-3">
                    <span className="block text-gray-500 mb-1">Documents</span>
                    <span className="text-white font-bold text-sm">
                      {economicPitch.documents}
                    </span>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-3">
                    <span className="block text-gray-500 mb-1">Viability</span>
                    <span className="text-green-400 font-bold text-sm">
                      {economicPitch.viability}%
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {economicPitch.statutes.map((s) => (
                    <span
                      key={s}
                      className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom Bar ──────────────────────────────────────────── */}
      <footer className="border-t border-gray-800/60 px-6 py-3 flex items-center justify-between">
        {/* Call progress dots */}
        <div className="flex items-center gap-2">
          {CALL_STEPS.map((step, i) => {
            const current = stepIndex(callState);
            const done = i <= current;
            return (
              <div key={step.key} className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full transition-colors duration-500 ${
                    done
                      ? i === current
                        ? 'bg-blue-400 shadow-[0_0_6px_rgba(59,130,246,0.5)]'
                        : 'bg-green-500'
                      : 'bg-gray-700'
                  }`}
                />
                <span
                  className={`text-[10px] tracking-wide ${
                    done ? 'text-gray-300' : 'text-gray-600'
                  }`}
                >
                  {step.label}
                </span>
                {i < CALL_STEPS.length - 1 && (
                  <div
                    className={`w-6 h-px ${done && i < current ? 'bg-green-500/40' : 'bg-gray-800'}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Timer */}
        <span className="font-mono text-sm text-gray-500">
          {formatTime(elapsedMs)} / 04:00
        </span>

        {/* Playback controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="text-xs font-medium px-4 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 transition-colors"
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-300 appearance-none cursor-pointer"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
            <option value={8}>8x</option>
          </select>
          <button
            onClick={restart}
            className="text-xs font-medium px-4 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Restart
          </button>
        </div>
      </footer>

      {/* ── Inline keyframes ────────────────────────────────────── */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
          50%      { box-shadow: 0 0 8px 2px rgba(34,197,94,0.4); }
        }
      `}</style>
    </div>
  );
}

/* ─── Status Badge ────────────────────────────────────────────────────── */

function StatusBadge({
  status,
  pulse,
}: {
  status: ElementStatus;
  pulse: boolean;
}) {
  const colors: Record<ElementStatus, string> = {
    pending: 'bg-gray-600/30 text-gray-500 border-gray-600/30',
    true: 'bg-green-500/20 text-green-400 border-green-500/30',
    partial: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    false: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  const labels: Record<ElementStatus, string> = {
    pending: 'Pending',
    true: 'Confirmed',
    partial: 'Partial',
    false: 'Not Met',
  };

  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border transition-all duration-300 ${colors[status]}`}
      style={
        pulse
          ? {
              animationName: 'pulseGlow',
              animationDuration: '1s',
              animationIterationCount: '2',
            }
          : undefined
      }
    >
      {labels[status]}
    </span>
  );
}
