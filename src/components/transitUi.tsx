import { useStore } from '../ui/store';
export { TRANSIT, LINE_COLORS } from '../game/transportation/transit';

export function TransitStopLabel({ id }: { id: number }) {
  const s = useStore();
  const st = s.world?.stops.get(id);
  return <span>{st ? st.name : 'Stop'}</span>;
}
