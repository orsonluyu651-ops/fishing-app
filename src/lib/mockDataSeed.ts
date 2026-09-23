export interface MockCatch {
  id: string;
  angler: string;
  species: string;
  weight: string;
  length: string;
  location: string;
  timestamp: number;
  tidePhase: 'High' | 'Low' | 'Incoming' | 'Outgoing';
}

export const generateMockCatches = (): MockCatch[] => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const spots = [
    { name: 'Southport Seaway', species: 'Flathead', weight: '2.8kg', length: '74cm', tides: ['High', 'Incoming'] },
    { name: 'Currumbin Creek Bar', species: 'Mangrove Jack', weight: '3.4kg', length: '52cm', tides: ['Low', 'Outgoing'] },
    { name: 'Jumpinpin Channel', species: 'Mulloway', weight: '12.5kg', length: '115cm', tides: ['High', 'Incoming'] }
  ];
  const anglers = ['Jack_R', 'Sunny_Coast_Fish', 'BreamKing', 'GoldCoast_Fisher'];

  return Array.from({ length: 12 }).map((_, idx) => {
    const spot = spots[idx % spots.length];
    const randomHoursAgo = Math.floor(Math.random() * 72) + 1;
    const phase = spot.tides[Math.floor(Math.random() * spot.tides.length)] as any;
    
    return {
      id: `mock-${idx}-${randomHoursAgo}`,
      angler: anglers[idx % anglers.length],
      species: spot.species,
      weight: spot.weight,
      length: spot.length,
      location: spot.name,
      timestamp: now - (randomHoursAgo * oneHour),
      tidePhase: phase
    };
  });
};
