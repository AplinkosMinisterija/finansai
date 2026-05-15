import * as React from 'react';

/**
 * Debounced reikšmė — atnaujinama tik praėjus `delay` ms nuo paskutinio
 * `value` pakeitimo. Naudojama search input'uose, kad nesiųstume užklausų
 * kiekvienam paspaudimui.
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState<T>(value);

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      window.clearTimeout(id);
    };
  }, [value, delay]);

  return debounced;
}
