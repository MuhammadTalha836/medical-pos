import { useEffect, useState } from 'react';
import { formatDuration } from '../utils/format';

/** Time on duty for the active shift ("2h 5m"), refreshed every 30 seconds. */
export function useShiftElapsed(startTime: string | null | undefined): string {
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  useEffect(() => {
    if (!startTime) {
      setElapsedMinutes(0);
      return;
    }
    const update = () => setElapsedMinutes(Math.floor(Math.max(0, Date.now() - new Date(startTime).getTime()) / 60000));
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [startTime]);

  return formatDuration(elapsedMinutes);
}
