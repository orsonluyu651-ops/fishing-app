import { SavedSpotMarker } from './mapSpotEngine';

export interface SpotWeatherAlert {
  spotName: string;
  isSevere: boolean;
  windSpeed: number;
  waveHeight: number;
  warningMessage: string | null;
}

/**
 * Checks weather parameters for a specific waypoint coordinate block against safety thresholds.
 */
export async function auditSpotSafetyConditions(spot: SavedSpotMarker): Promise<SpotWeatherAlert> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${spot.latitude}&longitude=${spot.longitude}&current=wind_speed_10m&hourly=wave_height&models=marine_gfs`;
    const response = await fetch(url);
    const data = await response.json();

    const windSpeed = data?.current?.wind_speed_10m ?? 0;
    const waveHeight = data?.hourly?.wave_height?.[0] ?? 0;

    // Severe conditions defined as winds over 25 knots (~46 km/h) or waves over 2.5 meters
    const isSevere = windSpeed > 46 || waveHeight > 2.5;
    let warningMessage: string | null = null;

    if (isSevere) {
      warningMessage = `Hazardous marine environment detected at "${spot.name}". Winds: ${windSpeed.toFixed(1)} km/h, Waves: ${waveHeight.toFixed(1)}m. Exercise extreme caution.`;
    }

    return { spotName: spot.name, isSevere, windSpeed, waveHeight, warningMessage };
  } catch (err) {
    console.error(`Weather alert scanning failure for spot ${spot.name}:`, err);
    return { spotName: spot.name, isSevere: false, windSpeed: 0, waveHeight: 0, warningMessage: null };
  }
}
