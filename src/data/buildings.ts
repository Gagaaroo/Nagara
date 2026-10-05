import { BuildingCategory, Zone } from '../game/types';

export type ServiceKind = 'police' | 'fire' | 'health' | 'edu1' | 'edu2' | 'edu3' | 'coaching' | 'waste' | 'park' | 'culture' | 'power' | 'water' | 'drain';
export type Shape =
  | 'house' | 'row' | 'apt' | 'tower' | 'complex' | 'shop' | 'mall' | 'market' | 'factory' | 'warehouse' | 'office' | 'ittower' | 'campus'
  | 'school' | 'hospital' | 'clinic' | 'station' | 'depot' | 'temple' | 'mosque' | 'church' | 'gurdwara' | 'plant' | 'solar' | 'wind' | 'tank'
  | 'pond' | 'park' | 'stadium' | 'govt' | 'small' | 'promenade' | 'stand' | 'mixed' | 'bazaar' | 'terminal';

export interface BuildingDef {
  key: string;
  name: string;
  cat: BuildingCategory;
  zone: Zone;
  w: number;
  h: number;
  minLevels: number;
  maxLevels: number;
  resPerLevel: number;
  jobsPerLevel: number;
  cost: number; // lakh to place (0 for zone-grown)
  upkeep: number; // lakh / month
  shape: Shape;
  service?: ServiceKind;
  radius?: number; // tiles
  capacity?: number; // service capacity (people) / MW / ML
  needsWaterEdge?: boolean;
  air?: number; // pollution emitted
  noise?: number;
  landValue?: number; // effect on neighbourhood
  visits?: number; // trip attractiveness weight
  desc?: string;
  unlock?: number; // population needed (0 = from start)
  wealth?: [number, number]; // min/max wealth class allowed for zone growth
}

const d = (o: Partial<BuildingDef> & Pick<BuildingDef, 'key' | 'name' | 'cat' | 'shape'>): BuildingDef => ({
  zone: Zone.None, w: 1, h: 1, minLevels: 1, maxLevels: 1, resPerLevel: 0, jobsPerLevel: 0, cost: 0, upkeep: 0, ...o,
});

export const BUILDINGS: BuildingDef[] = [
  // ── residential, grown by zoning ──
  d({ key: 'house', name: 'Individual House', cat: 'res', zone: Zone.ResLow, shape: 'house', minLevels: 1, maxLevels: 2, resPerLevel: 5, wealth: [0, 2] }),
  d({ key: 'row_house', name: 'Row Houses', cat: 'res', zone: Zone.ResLow, shape: 'row', minLevels: 2, maxLevels: 3, resPerLevel: 7, wealth: [0, 1] }),
  d({ key: 'small_apt', name: 'Small Apartments', cat: 'res', zone: Zone.ResLow, shape: 'apt', minLevels: 3, maxLevels: 4, resPerLevel: 10, wealth: [0, 2] }),
  d({ key: 'apt_block', name: 'Apartment Block', cat: 'res', zone: Zone.ResMed, shape: 'apt', w: 2, h: 1, minLevels: 4, maxLevels: 7, resPerLevel: 13, wealth: [0, 1] }),
  d({ key: 'modern_apt', name: 'Modern Apartments', cat: 'res', zone: Zone.ResMed, shape: 'tower', w: 2, h: 2, minLevels: 6, maxLevels: 10, resPerLevel: 15, wealth: [1, 2] }),
  d({ key: 'tower', name: 'Residential Tower', cat: 'res', zone: Zone.ResHigh, shape: 'tower', w: 2, h: 2, minLevels: 12, maxLevels: 24, resPerLevel: 13, wealth: [0, 2] }),
  d({ key: 'complex', name: 'Apartment Complex', cat: 'res', zone: Zone.ResHigh, shape: 'complex', w: 3, h: 2, minLevels: 8, maxLevels: 14, resPerLevel: 24, wealth: [0, 2] }),
  // ── commercial ──
  d({ key: 'shop', name: 'Shops', cat: 'com', zone: Zone.Commercial, shape: 'shop', minLevels: 1, maxLevels: 2, jobsPerLevel: 6, visits: 1 }),
  d({ key: 'restaurant', name: 'Restaurants', cat: 'com', zone: Zone.Commercial, shape: 'shop', minLevels: 1, maxLevels: 2, jobsPerLevel: 8, visits: 1.3 }),
  d({ key: 'shop_street', name: 'Shopping Street', cat: 'com', zone: Zone.Commercial, shape: 'bazaar', w: 2, h: 1, minLevels: 2, maxLevels: 3, jobsPerLevel: 12, visits: 2 }),
  d({ key: 'mall', name: 'Shopping Centre', cat: 'com', zone: Zone.Commercial, shape: 'mall', w: 2, h: 2, minLevels: 2, maxLevels: 4, jobsPerLevel: 26, visits: 4, wealth: [1, 2] }),
  // ── mixed-use ──
  d({ key: 'mixed_low', name: 'Shophouse', cat: 'mixed', zone: Zone.Mixed, shape: 'mixed', minLevels: 3, maxLevels: 4, resPerLevel: 7, jobsPerLevel: 3, visits: 0.8 }),
  d({ key: 'mixed_mid', name: 'Mixed-Use Block', cat: 'mixed', zone: Zone.Mixed, shape: 'mixed', w: 2, h: 1, minLevels: 5, maxLevels: 8, resPerLevel: 10, jobsPerLevel: 5, visits: 1.4 }),
  d({ key: 'mixed_high', name: 'Mixed-Use Tower', cat: 'mixed', zone: Zone.Mixed, shape: 'tower', w: 2, h: 2, minLevels: 9, maxLevels: 16, resPerLevel: 12, jobsPerLevel: 6, visits: 2 }),
  // ── industrial ──
  d({ key: 'workshop', name: 'Workshops', cat: 'ind', zone: Zone.Industrial, shape: 'factory', minLevels: 1, maxLevels: 1, jobsPerLevel: 10, air: 0.4, noise: 0.5 }),
  d({ key: 'factory', name: 'Factory', cat: 'ind', zone: Zone.Industrial, shape: 'factory', w: 2, h: 2, minLevels: 1, maxLevels: 2, jobsPerLevel: 34, air: 1.2, noise: 1 }),
  d({ key: 'warehouse_z', name: 'Warehouse', cat: 'logistics', zone: Zone.Industrial, shape: 'warehouse', w: 2, h: 2, minLevels: 1, maxLevels: 1, jobsPerLevel: 14, noise: 0.3 }),
  // ── office / IT ──
  d({ key: 'office', name: 'Corporate Office', cat: 'office', zone: Zone.Office, shape: 'office', w: 2, h: 1, minLevels: 3, maxLevels: 7, jobsPerLevel: 22, visits: 0.5 }),
  d({ key: 'it_tower', name: 'IT Tower', cat: 'office', zone: Zone.Office, shape: 'ittower', w: 2, h: 2, minLevels: 8, maxLevels: 18, jobsPerLevel: 30, visits: 0.4, unlock: 25000 }),
  d({ key: 'biz_park', name: 'Business Park', cat: 'office', zone: Zone.Office, shape: 'office', w: 3, h: 2, minLevels: 3, maxLevels: 5, jobsPerLevel: 40, visits: 0.5, unlock: 10000 }),
  d({ key: 'tech_campus', name: 'Technology Campus', cat: 'office', zone: Zone.Office, shape: 'campus', w: 3, h: 3, minLevels: 3, maxLevels: 6, jobsPerLevel: 70, visits: 0.4, unlock: 25000 }),

  // ── markets (placeable) ──
  d({ key: 'market_local', name: 'Local Market', cat: 'market', shape: 'market', w: 2, h: 1, minLevels: 1, maxLevels: 1, jobsPerLevel: 24, cost: 45, upkeep: 0.4, visits: 5, landValue: 0.5, desc: 'Daily-needs bazaar. Draws walkers, autos and delivery vans.' }),
  d({ key: 'market_veg', name: 'Vegetable Market', cat: 'market', shape: 'market', w: 2, h: 2, jobsPerLevel: 40, cost: 70, upkeep: 0.5, visits: 6, landValue: 0.4, desc: 'Fresh produce market. Early-morning deliveries.' }),
  d({ key: 'market_wholesale', name: 'Wholesale Market', cat: 'market', shape: 'market', w: 3, h: 2, jobsPerLevel: 80, cost: 150, upkeep: 1.2, visits: 4, noise: 0.8, unlock: 3000, desc: 'Heavy goods traffic. Place on a freight corridor.' }),
  d({ key: 'street_food', name: 'Street-Food District', cat: 'market', shape: 'bazaar', w: 2, h: 1, jobsPerLevel: 26, cost: 40, upkeep: 0.3, visits: 5, landValue: 0.6, desc: 'Evening crowds on foot.' }),
  d({ key: 'shopping_lane', name: 'Shopping Street', cat: 'market', shape: 'bazaar', w: 3, h: 1, jobsPerLevel: 30, cost: 80, upkeep: 0.6, visits: 5, landValue: 0.6, unlock: 1500 }),

  // ── services ──
  d({ key: 'police', name: 'Police Station', cat: 'service', shape: 'small', service: 'police', radius: 15, cost: 40, upkeep: 2, jobsPerLevel: 14, desc: 'Public safety coverage.' }),
  d({ key: 'fire', name: 'Fire Station', cat: 'service', shape: 'small', w: 2, h: 1, service: 'fire', radius: 16, cost: 55, upkeep: 2.5, jobsPerLevel: 14, desc: 'Fire engines and rescue.' }),
  d({ key: 'clinic', name: 'Clinic', cat: 'service', shape: 'clinic', service: 'health', radius: 9, capacity: 800, cost: 28, upkeep: 1.2, jobsPerLevel: 10, desc: 'Primary healthcare.' }),
  d({ key: 'hospital_gov', name: 'Government Hospital', cat: 'service', shape: 'hospital', w: 2, h: 2, service: 'health', radius: 20, capacity: 6000, cost: 380, upkeep: 12, jobsPerLevel: 70, unlock: 2500, visits: 3, desc: 'Public hospital with emergency ward.' }),
  d({ key: 'hospital_pvt', name: 'Private Hospital', cat: 'service', shape: 'hospital', w: 2, h: 2, service: 'health', radius: 18, capacity: 5000, cost: 450, upkeep: 8, jobsPerLevel: 80, unlock: 4000, visits: 3, landValue: 0.5, desc: 'High-end care. Raises land value nearby.' }),
  d({ key: 'emergency', name: 'Emergency Centre', cat: 'service', shape: 'hospital', w: 2, h: 1, service: 'health', radius: 18, capacity: 2500, cost: 140, upkeep: 5, jobsPerLevel: 40, unlock: 2500, desc: 'Ambulance dispatch.' }),
  d({ key: 'school', name: 'School', cat: 'service', shape: 'school', w: 2, h: 2, service: 'edu1', radius: 12, capacity: 900, cost: 90, upkeep: 3, jobsPerLevel: 40, visits: 2, desc: 'Morning and afternoon peaks.' }),
  d({ key: 'college', name: 'College', cat: 'service', shape: 'school', w: 2, h: 2, service: 'edu2', radius: 20, capacity: 2200, cost: 260, upkeep: 7, jobsPerLevel: 60, unlock: 3000, visits: 2, desc: 'Draws young commuters.' }),
  d({ key: 'university', name: 'University', cat: 'service', shape: 'campus', w: 3, h: 3, service: 'edu3', radius: 32, capacity: 6000, cost: 750, upkeep: 20, jobsPerLevel: 120, unlock: 10000, visits: 3, landValue: 0.5, desc: 'Citywide draw. Feeds IT growth.' }),
  d({ key: 'coaching', name: 'Coaching Centre', cat: 'service', shape: 'small', service: 'coaching', radius: 10, capacity: 500, cost: 30, upkeep: 0.8, jobsPerLevel: 14, visits: 2, unlock: 1500, desc: 'Evening classes.' }),
  d({ key: 'waste', name: 'Waste Transfer Station', cat: 'service', shape: 'warehouse', w: 2, h: 2, service: 'waste', radius: 22, cost: 90, upkeep: 3, air: 0.7, noise: 0.5, jobsPerLevel: 24, desc: 'Collects and processes garbage.' }),
  d({ key: 'park_small', name: 'Neighbourhood Park', cat: 'park', shape: 'park', service: 'park', radius: 8, cost: 14, upkeep: 0.3, landValue: 0.6, desc: 'Trees, walking paths, play area.' }),
  d({ key: 'park_big', name: 'City Park', cat: 'park', shape: 'park', w: 2, h: 2, service: 'park', radius: 14, cost: 60, upkeep: 1, landValue: 0.8, desc: 'Lawns, trees and lakes.' }),
  d({ key: 'playground', name: 'Playground & Maidan', cat: 'park', shape: 'park', w: 2, h: 1, service: 'park', radius: 9, cost: 20, upkeep: 0.4, landValue: 0.5, desc: 'Open ground for sport.' }),

  // ── community / cultural ──
  d({ key: 'temple', name: 'Temple', cat: 'culture', shape: 'temple', w: 2, h: 2, service: 'culture', radius: 11, cost: 80, upkeep: 0.5, visits: 2.5, landValue: 0.4, jobsPerLevel: 6, desc: 'Community landmark and festival destination.' }),
  d({ key: 'mosque', name: 'Mosque', cat: 'culture', shape: 'mosque', w: 2, h: 2, service: 'culture', radius: 11, cost: 80, upkeep: 0.5, visits: 2.5, landValue: 0.4, jobsPerLevel: 6, desc: 'Community landmark and prayer-time destination.' }),
  d({ key: 'church', name: 'Church', cat: 'culture', shape: 'church', w: 2, h: 1, service: 'culture', radius: 11, cost: 70, upkeep: 0.5, visits: 2.5, landValue: 0.4, jobsPerLevel: 5, desc: 'Community landmark and Sunday gathering place.' }),
  d({ key: 'gurdwara', name: 'Gurdwara', cat: 'culture', shape: 'gurdwara', w: 2, h: 2, service: 'culture', radius: 11, cost: 80, upkeep: 0.5, visits: 2.5, landValue: 0.4, jobsPerLevel: 6, desc: 'Community landmark with a community kitchen.' }),

  // ── utilities ──
  d({ key: 'power_small', name: 'Diesel Power Plant', cat: 'utility', shape: 'plant', w: 2, h: 2, service: 'power', radius: 16, capacity: 14, cost: 120, upkeep: 2.2, air: 1, noise: 1, jobsPerLevel: 20, desc: 'Starter plant. 14 MW. Polluting.' }),
  d({ key: 'power_thermal', name: 'Thermal Power Plant', cat: 'utility', shape: 'plant', w: 3, h: 3, service: 'power', radius: 18, capacity: 120, cost: 1100, upkeep: 30, air: 3, noise: 1.2, jobsPerLevel: 80, unlock: 8000, desc: '120 MW baseload. Keep away from homes.' }),
  d({ key: 'power_solar', name: 'Solar Park', cat: 'utility', shape: 'solar', w: 3, h: 2, service: 'power', radius: 14, capacity: 30, cost: 700, upkeep: 6, jobsPerLevel: 8, unlock: 3000, desc: '30 MW. Clean, space-hungry.' }),
  d({ key: 'power_wind', name: 'Wind Farm', cat: 'utility', shape: 'wind', w: 2, h: 2, service: 'power', radius: 14, capacity: 18, cost: 420, upkeep: 4, jobsPerLevel: 6, unlock: 3000, desc: '18 MW. Best on high ground.' }),
  d({ key: 'substation', name: 'Substation', cat: 'utility', shape: 'small', service: 'power', radius: 13, capacity: 0, cost: 36, upkeep: 0.8, noise: 0.3, desc: 'Extends the power grid. Dense districts can go underground.' }),
  d({ key: 'borewell', name: 'Borewell Station', cat: 'utility', shape: 'tank', service: 'water', radius: 9, capacity: 2.4, cost: 12, upkeep: 0.3, desc: 'Groundwater. Small, modest yield.' }),
  d({ key: 'water_pump', name: 'River Intake Pump', cat: 'utility', shape: 'tank', service: 'water', radius: 14, capacity: 20, cost: 160, upkeep: 2.5, needsWaterEdge: true, desc: 'Draws from a river, lake or reservoir within 3 tiles.' }),
  d({ key: 'water_treatment', name: 'Water Treatment Plant', cat: 'utility', shape: 'plant', w: 2, h: 2, service: 'water', radius: 16, capacity: 40, cost: 320, upkeep: 5, unlock: 2000, noise: 0.3, desc: 'Purifies supply. Required for big populations.' }),
  d({ key: 'water_tower', name: 'Water Tower', cat: 'utility', shape: 'tank', service: 'water', radius: 14, capacity: 0, cost: 48, upkeep: 0.5, desc: 'Pressure and distribution for nearby streets.' }),
  d({ key: 'stormwater', name: 'Stormwater Pond', cat: 'utility', shape: 'pond', w: 2, h: 2, service: 'drain', radius: 14, capacity: 1, cost: 110, upkeep: 1, unlock: 1500, landValue: 0.3, desc: 'Detention pond. Relieves flooding in heavy rain.' }),

  // ── transit & logistics buildings ──
  d({ key: 'auto_stand', name: 'Auto Stand', cat: 'transit', shape: 'stand', cost: 5, upkeep: 0.1, radius: 7, desc: 'Organises auto-rickshaws and cuts roadside stopping.' }),
  d({ key: 'bus_depot', name: 'Bus Depot', cat: 'transit', shape: 'depot', w: 3, h: 2, cost: 120, upkeep: 1.2, jobsPerLevel: 30, noise: 0.4, desc: 'Garage that supplies buses to routes.' }),
  d({ key: 'bus_terminal', name: 'Bus Terminal', cat: 'transit', shape: 'terminal', w: 3, h: 2, cost: 190, upkeep: 2.5, jobsPerLevel: 24, visits: 3, unlock: 1500, desc: 'A major interchange. Auto and walking demand.' }),
  d({ key: 'truck_terminal', name: 'Truck Terminal', cat: 'logistics', shape: 'warehouse', w: 3, h: 2, cost: 150, upkeep: 2, jobsPerLevel: 30, noise: 0.8, air: 0.5, unlock: 5000, desc: 'Staging yard for heavy trucks.' }),
  d({ key: 'warehouse', name: 'Warehouse', cat: 'logistics', shape: 'warehouse', w: 2, h: 2, cost: 60, upkeep: 0.6, jobsPerLevel: 14, noise: 0.3, desc: 'Stores goods between factories and shops.' }),
  d({ key: 'logistics_hub', name: 'Logistics Hub', cat: 'logistics', shape: 'warehouse', w: 3, h: 3, cost: 650, upkeep: 8, jobsPerLevel: 40, noise: 1, air: 0.6, unlock: 40000, desc: 'Consolidates regional freight and last-mile delivery.' }),
  d({ key: 'metro_depot', name: 'Metro Depot', cat: 'transit', shape: 'depot', w: 3, h: 3, cost: 900, upkeep: 8, jobsPerLevel: 50, noise: 0.5, unlock: 20000, desc: 'Stables and maintains metro trains.' }),
  d({ key: 'rail_yard', name: 'Rail Yard', cat: 'transit', shape: 'depot', w: 3, h: 3, cost: 1200, upkeep: 10, jobsPerLevel: 50, noise: 0.8, unlock: 40000, desc: 'Stables suburban and regional trains.' }),
  d({ key: 'station_metro', name: 'Metro Station', cat: 'transit', shape: 'station', w: 2, h: 1, cost: 250, upkeep: 2, jobsPerLevel: 16, visits: 5, unlock: 20000 }),
  d({ key: 'station_suburban', name: 'Suburban Rail Station', cat: 'transit', shape: 'station', w: 3, h: 1, cost: 300, upkeep: 2.5, jobsPerLevel: 18, visits: 5, unlock: 35000 }),
  d({ key: 'station_regional', name: 'Regional Rail Station', cat: 'transit', shape: 'station', w: 3, h: 2, cost: 700, upkeep: 6, jobsPerLevel: 40, visits: 7, unlock: 50000 }),

  // ── landmarks ──
  d({ key: 'lm_central_station', name: 'Central Railway Station', cat: 'landmark', shape: 'station', w: 3, h: 3, cost: 1500, upkeep: 12, jobsPerLevel: 120, visits: 10, landValue: 0.9, unlock: 25000, desc: 'A grand terminus. Major hub for walking, autos and buses.' }),
  d({ key: 'lm_govt', name: 'Government Complex', cat: 'landmark', shape: 'govt', w: 3, h: 3, cost: 900, upkeep: 8, jobsPerLevel: 160, visits: 4, landValue: 0.6, unlock: 5000, desc: 'Administrative offices. Many commuters.' }),
  d({ key: 'lm_temple', name: 'Temple Complex', cat: 'landmark', shape: 'temple', w: 3, h: 3, cost: 600, upkeep: 2, jobsPerLevel: 40, visits: 8, landValue: 0.8, unlock: 5000, service: 'culture', radius: 16, desc: 'Festival crowds, pilgrims and vendors.' }),
  d({ key: 'lm_market', name: 'City Market', cat: 'landmark', shape: 'market', w: 3, h: 3, cost: 500, upkeep: 3, jobsPerLevel: 120, visits: 10, landValue: 0.7, unlock: 5000, desc: 'The heart of retail. Needs good freight and walking access.' }),
  d({ key: 'lm_it', name: 'Tech Landmark Tower', cat: 'landmark', shape: 'ittower', w: 2, h: 2, cost: 900, upkeep: 6, minLevels: 28, maxLevels: 28, jobsPerLevel: 55, visits: 1, landValue: 0.9, unlock: 25000, desc: 'A signature IT tower.' }),
  d({ key: 'lm_stadium', name: 'Stadium', cat: 'landmark', shape: 'stadium', w: 3, h: 3, cost: 1100, upkeep: 6, jobsPerLevel: 40, visits: 9, landValue: 0.5, unlock: 10000, desc: 'Event-day surges.' }),
  d({ key: 'lm_central_park', name: 'Central Park', cat: 'landmark', shape: 'park', w: 3, h: 3, service: 'park', radius: 20, cost: 300, upkeep: 2, landValue: 1, unlock: 3000, desc: 'A green heart for the city.' }),
  d({ key: 'lm_waterfront', name: 'Waterfront Promenade', cat: 'landmark', shape: 'promenade', w: 3, h: 1, service: 'park', radius: 14, cost: 220, upkeep: 1.2, landValue: 1, needsWaterEdge: true, unlock: 3000, visits: 5, desc: 'Walkway on the water. Must sit at the shore.' }),
];

export const DEFS: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.key, b]));

/** Candidates the zoning growth system may pick from. */
export function growthDefs(zone: Zone): BuildingDef[] {
  return BUILDINGS.filter((b) => b.zone === zone && b.cost === 0);
}

export const ZONE_INFO: Record<number, { name: string; color: number; hex: string; unlock: number; desc: string }> = {
  [Zone.ResLow]: { name: 'Residential — Low', color: 0x7fb069, hex: '#7fb069', unlock: 0, desc: 'Houses, row houses, small apartments.' },
  [Zone.ResMed]: { name: 'Residential — Medium', color: 0x4f9a63, hex: '#4f9a63', unlock: 0, desc: 'Apartment blocks and mixed residential.' },
  [Zone.ResHigh]: { name: 'Residential — High', color: 0x2e7f55, hex: '#2e7f55', unlock: 25000, desc: 'Towers and large complexes.' },
  [Zone.Commercial]: { name: 'Commercial', color: 0x5aa6d6, hex: '#5aa6d6', unlock: 0, desc: 'Shops, restaurants, shopping streets.' },
  [Zone.Mixed]: { name: 'Mixed-Use', color: 0xe0a458, hex: '#e0a458', unlock: 1500, desc: 'Shops below, homes or offices above. Generates short trips.' },
  [Zone.Industrial]: { name: 'Industrial', color: 0xb8a064, hex: '#b8a064', unlock: 0, desc: 'Workshops, factories, warehouses.' },
  [Zone.Office]: { name: 'Office & IT', color: 0x8a7fd0, hex: '#8a7fd0', unlock: 4000, desc: 'Offices; IT towers and campuses once the city is big.' },
};

export const STORY_THRESHOLDS = [500, 2500, 10000, 25000, 50000];
