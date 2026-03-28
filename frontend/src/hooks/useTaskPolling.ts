import { useEffect, useRef, useState } from "react";
import { getTaskStatus, TaskStatus } from "../services/api";

const POLL_INTERVAL_MS = 3000;

/**
 * Hace polling de GET /tasks/{taskId} cada 3 segundos
 * hasta que el estado sea 'completed' o 'failed'.
 */
export function useTaskPolling(taskId: string | null) {
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!taskId) return;

    const poll = async () => {
      try {
        const status = await getTaskStatus(taskId);
        setTaskStatus(status);

        if (status.status === "completed" || status.status === "failed") {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch (err) {
        setError("Error al consultar el estado de la tarea");
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [taskId]);

  return { taskStatus, error };
}
