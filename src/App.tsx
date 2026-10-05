import { useEffect } from 'react';
import { useStore } from './ui/store';
import { GameCanvas } from './components/GameCanvas';
import { MainMenu, MapGenerator, SettingsScreen, LoadScreen } from './components/Menus';
import { GameHud } from './components/Hud';

export function App() {
  const s = useStore();
  useEffect(() => {
    s.refreshAutosave();
    const p = new URLSearchParams(location.search);
    if (p.has('autostart')) { s.regenTerrain(); s.startNew(); }
  }, []);
  if (s.screen === 'game' && s.world) {
    return (<><GameCanvas worldKey={s.worldId} /><GameHud /></>);
  }
  if (s.screen === 'newcity') return <MapGenerator />;
  if (s.screen === 'settings') return <SettingsScreen />;
  if (s.screen === 'load') return <LoadScreen />;
  return <MainMenu />;
}
