import { useEffect, useState } from 'react';

/**
 * The value, but only after it has stopped changing for `delay` ms.
 *
 * Search boxes filter as you type. Without this, every keystroke is a request
 * and the answers can arrive out of order — the list then shows the result of
 * a query the user has already typed past.
 */
export default function useDebounced(value, delay = 300) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return settled;
}
