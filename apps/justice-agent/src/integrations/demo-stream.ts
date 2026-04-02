/**
 * Demo Stream — SSE event emitter for the /demo dashboard.
 *
 * Justice-agent code calls emit() throughout the call flow.
 * Connected SSE clients (demo-portal) receive events in real time.
 *
 * Usage:
 *   import { demoStream } from '../integrations/demo-stream';
 *   demoStream.emit({ type: 'transcript', data: { speaker: 'justice', text: 'Hello...' } });
 *
 * SSE endpoint is registered in executive-webhook.ts at GET /api/demo/stream
 */

import type { ServerResponse } from 'http';

export interface DemoEvent {
  timestamp: number;
  type:
    | 'transcript'
    | 'element_update'
    | 'statute_trigger'
    | 'viability_update'
    | 'call_state'
    | 'document_received'
    | 'economic_pitch'
    | 'session_start'
    | 'session_end';
  data: Record<string, unknown>;
}

class DemoStream {
  private clients: Set<ServerResponse> = new Set();
  private sessionStart: number = 0;
  private eventLog: DemoEvent[] = [];

  /** Register a new SSE client. Returns cleanup function. */
  addClient(res: ServerResponse): () => void {
    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Send buffered events so late-joining clients catch up
    for (const event of this.eventLog) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    this.clients.add(res);
    console.log(`[demo-stream] Client connected (${this.clients.size} total)`);

    return () => {
      this.clients.delete(res);
      console.log(`[demo-stream] Client disconnected (${this.clients.size} total)`);
    };
  }

  /** Start a new demo session. Resets the event log and timestamp origin. */
  startSession(sessionId: string): void {
    this.sessionStart = Date.now();
    this.eventLog = [];
    this.emit({ type: 'session_start', data: { sessionId, startedAt: new Date().toISOString() } });
    console.log(`[demo-stream] Session started: ${sessionId}`);
  }

  /** End the current demo session. */
  endSession(): void {
    this.emit({ type: 'session_end', data: { endedAt: new Date().toISOString() } });
    console.log(`[demo-stream] Session ended`);
  }

  /** Emit a demo event to all connected SSE clients. */
  emit(partial: Omit<DemoEvent, 'timestamp'>): void {
    const event: DemoEvent = {
      timestamp: this.sessionStart > 0 ? Date.now() - this.sessionStart : 0,
      ...partial,
    };

    this.eventLog.push(event);

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /** Emit a transcript line. */
  transcript(speaker: 'justice' | 'plaintiff', text: string): void {
    this.emit({ type: 'transcript', data: { speaker, text } });
  }

  /** Emit an element score update. */
  elementUpdate(element: string, status: 'pending' | 'true' | 'partial' | 'false', reasoning: string): void {
    this.emit({ type: 'element_update', data: { element, status, reasoning } });
  }

  /** Emit a statute trigger. */
  statuteTrigger(name: string, citation: string): void {
    this.emit({ type: 'statute_trigger', data: { name, citation } });
  }

  /** Emit a viability score update. */
  viabilityUpdate(score: number, tier: string): void {
    this.emit({ type: 'viability_update', data: { score, tier } });
  }

  /** Emit a call state change. */
  callState(state: string): void {
    this.emit({ type: 'call_state', data: { state } });
  }

  /** Emit a document received event. */
  documentReceived(name: string, docType: string): void {
    this.emit({ type: 'document_received', data: { name, type: docType } });
  }

  /** Emit the economic pitch. */
  economicPitch(pitch: string, damages: { low: number; high: number }): void {
    this.emit({ type: 'economic_pitch', data: { pitch, damages_low: damages.low, damages_high: damages.high } });
  }

  /** Get current client count. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Get the full event log for the current session. */
  getEventLog(): DemoEvent[] {
    return [...this.eventLog];
  }
}

/** Singleton demo stream instance. */
export const demoStream = new DemoStream();
