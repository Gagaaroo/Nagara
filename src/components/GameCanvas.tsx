import { useEffect, useRef } from 'react';
import { store } from '../ui/store';
import { GameView } from '../rendering/gameView';

/** Hosts the WebGL view. Re-created whenever a new world is attached. */
export function GameCanvas({ worldKey }: { worldKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !store.world) return;
    const view = new GameView(ref.current, store);
    store.view = view;
    (window as any).__nagara = { store, view };
    return () => { view.dispose(); if (store.view === view) store.view = null; };
  }, [worldKey]);
  return <div ref={ref} className="game-canvas" />;
}
