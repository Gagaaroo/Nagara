import { useEffect, useRef } from 'react';
import { store } from '../ui/store';
import { GameView } from '../rendering/gameView';
import * as actions from '../game/actions';
import * as transit from '../game/transportation/transit';
import { previewRoad } from '../game/actions';
import { lineSamples } from '../game/roads/geometry';

/** Hosts the WebGL view. Re-created whenever a new world is attached. */
export function GameCanvas({ worldKey }: { worldKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !store.world) return;
    const view = new GameView(ref.current, store);
    store.view = view;
    (window as any).__nagara = { store, view, previewRoad, lineSamples, actions, transit };
    return () => { view.dispose(); if (store.view === view) store.view = null; };
  }, [worldKey]);
  return <div ref={ref} className="game-canvas" />;
}
