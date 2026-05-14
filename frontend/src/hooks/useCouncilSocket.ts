import { useCallback, useRef, useEffect } from "react";
import { useCouncilStore } from "../stores/councilStore";

const WS_BASE = `ws://${window.location.hostname}:5173/ws`;

export function useCouncilSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handleWsEvent = useCouncilStore((s) => s.handleWsEvent);
  const setStatus = useCouncilStore((s) => s.setStatus);
  const reset = useCouncilStore((s) => s.reset);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const startAnalysis = useCallback(
    (situation: string, sessionId: string, userId: number) => {
      reset();
      setStatus("processing");

      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket(`${WS_BASE}/${sessionId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            situation,
            user_id: userId,
          })
        );
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data);
          handleWsEvent(event);
        } catch (e) {
          console.error("Failed to parse WS message:", e);
        }
      };

      ws.onerror = () => {
        setStatus("failed");
      };

      ws.onclose = () => {
        const currentStatus = useCouncilStore.getState().status;
        if (currentStatus === "processing") {
          setStatus("failed");
        }
      };
    },
    [handleWsEvent, setStatus, reset]
  );

  const cancelAnalysis = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setStatus("idle");
  }, [setStatus]);

  return { startAnalysis, cancelAnalysis };
}
