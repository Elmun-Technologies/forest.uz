'use client';

import type { CommerceEventName, TrackPropsMap } from '@forest/contracts/core';
import { useEffect } from 'react';
import { track } from '@/lib/track';

/** Fires one commerce event when a server-rendered view mounts (or its props change). */
export function TrackView<N extends CommerceEventName>({
  name,
  props,
}: {
  name: N;
  props: TrackPropsMap[N];
}) {
  const key = JSON.stringify(props);
  useEffect(() => {
    track(name, JSON.parse(key) as TrackPropsMap[N]);
  }, [name, key]);
  return null;
}
