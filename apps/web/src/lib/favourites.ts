import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { ClientApiError, clientApi } from './client-api';
import { readCookie } from './consent';
import { onIdle } from './idle';

/**
 * Favourites store shared by every heart on the page. Guests keep ids in localStorage;
 * identified customers (`fr_ident`, mirrored from the httpOnly session) use `/me/favorites`,
 * fetched once per page load. On login the guest list is merged into the account.
 */
const KEY = 'fr_favs';

type Snapshot = { ids: ReadonlySet<string>; remote: boolean };
let snapshot: Snapshot = { ids: new Set(), remote: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function readLocal(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocal(ids: Iterable<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids].slice(-100)));
  } catch {
    /* storage disabled */
  }
}

function load(): Promise<void> {
  loading ??= (async () => {
    if (readCookie('fr_ident') === '1') {
      try {
        const items = await clientApi.me.favorites();
        set({ ids: new Set(items.map((p) => p.id)), remote: true });
        return;
      } catch {
        // Expired session or API down → keep working locally.
      }
    }
    set({ ids: new Set(readLocal()), remote: false });
  })();
  return loading;
}

async function toggle(productId: string) {
  await load();
  const had = snapshot.ids.has(productId);
  const ids = new Set(snapshot.ids);
  if (had) ids.delete(productId);
  else ids.add(productId);
  const prev = snapshot;
  set({ ...snapshot, ids });
  if (!snapshot.remote) return writeLocal(ids);
  try {
    if (had) await clientApi.me.removeFavorite(productId);
    else await clientApi.me.addFavorite(productId);
  } catch (e) {
    if (e instanceof ClientApiError && e.status === 401) {
      writeLocal(ids);
      set({ ids, remote: false });
    } else set(prev);
  }
}

/** After login: push guest favourites into the account, then read the account list. */
export async function mergeLocalFavourites(): Promise<void> {
  const local = readLocal();
  await Promise.allSettled(local.map((id) => clientApi.me.addFavorite(id)));
  writeLocal([]);
  loading = null;
}

/** Call after logout so hearts fall back to the (empty) guest list. */
export function resetFavourites() {
  loading = null;
  set({ ids: new Set(), remote: false });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => snapshot;

export function useFavourite(productId: string): [boolean, () => void] {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Hearts render unfilled on the server anyway; reading the list can wait until hydration is done.
  useEffect(() => onIdle(() => void load()), []);
  const flip = useCallback(() => void toggle(productId), [productId]);
  return [s.ids.has(productId), flip];
}
