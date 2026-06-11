import { useCallback, useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graphStore';
import type { WSEvent } from '../types';

const WS_BASE = `ws://${window.location.hostname}:5173/ws`;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);

  // Get stable store references (Zustand selectors are stable)
  const setGraph = useGraphStore((s) => s.setGraph);
  const updateNodeOutput = useGraphStore((s) => s.updateNodeOutput);
  const setActiveNode = useGraphStore((s) => s.setActiveNode);
  const setStatus = useGraphStore((s) => s.setStatus);
  const setFinalVerdict = useGraphStore((s) => s.setFinalVerdict);
  const addEdgeConflict = useGraphStore((s) => s.addEdgeConflict);

  // Stable event handler — defined before connect so connect can close over it
  const handleEvent = useCallback((event: WSEvent) => {
    switch (event.type) {
      case 'graph_ready':
        setGraph(event.graph);
        break;

      case 'node_start':
        setActiveNode(event.node_id);
        break;

      case 'node_stream':
        break;

      case 'node_done':
        updateNodeOutput(event.node_id, {
          output: event.output,
          confidence: event.confidence,
          verdict: event.verdict,
          sentiment: event.sentiment,
        });
        setActiveNode(null);
        break;

      case 'edge_conflict':
        addEdgeConflict({
          from: event.from,
          to: event.to,
          summary: event.summary,
        });
        break;

      case 'analysis_complete':
        setFinalVerdict(event.final_verdict);
        break;

      case 'error':
        setStatus('error');
        break;
    }
  }, [
    setGraph,
    setActiveNode,
    updateNodeOutput,
    setFinalVerdict,
    addEdgeConflict,
    setStatus,
  ]);

  const connect = useCallback((sessionId: string, payload: Record<string, unknown>) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const url = `${WS_BASE}/${sessionId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (msg) => {
      try {
        const event: WSEvent = JSON.parse(msg.data);
        handleEvent(event);
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    ws.onerror = () => {
      setStatus('error');
    };

    ws.onclose = () => {
      // Cleanup ref on close
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [handleEvent, setStatus]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { connect, disconnect, sendMessage };
}
