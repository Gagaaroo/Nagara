import { Rng, pick } from '../utils/rng';

const CITY_PRE = ['Nava', 'Sura', 'Vista', 'Aroha', 'Dakshi', 'Chandra', 'Meghna', 'Sarva', 'Anand', 'Tara', 'Isha', 'Veda', 'Kiran', 'Lakshya', 'Prana', 'Amara', 'Nira', 'Surya', 'Ujjwal', 'Tej'];
const CITY_SUF = ['nagar', 'pura', 'vati', 'gram', 'palli', 'ganj', 'kunj', 'dhara', 'setu', 'ara', 'puram', 'nilaya'];
const FIXED = ['Nagarika', 'Navanagar', 'Vistara', 'Dakshin', 'Aroha', 'Suryanagar'];

export function cityName(r: Rng): string {
  if (r() < 0.4) return pick(r, FIXED);
  return pick(r, CITY_PRE) + pick(r, CITY_SUF);
}

const WATER = ['Meghna', 'Veda', 'Tara', 'Sarasa', 'Neela', 'Kaveri-ish'.replace('-ish', 'a'), 'Amrita', 'Jeevan', 'Shanti', 'Surabhi', 'Indira'];
export function waterName(r: Rng, kind: string): string {
  return `${pick(r, WATER)} ${kind}`;
}

const AREAS = ['Market Road', 'Lake View', 'Station Road', 'Temple Street', 'Green Park', 'Tech Park', 'Old Town', 'New Extension', 'Riverside', 'Hill Colony', 'Central', 'Industrial Estate', 'Civil Lines', 'Garden Layout', 'Ring Road', 'Harbour Lane'];
export const areaNames = AREAS;

// Fictional, hindi/regional-inspired shop signage text. No real brands.
export const SIGN_TEXT = ['स्वागत', 'दुकान', 'बाज़ार', 'चाय', 'ತಿಂಡಿ', 'அங்காடி', 'మార్కెట్', 'Fresh Mart', 'City Stores', 'Anna Tiffin', 'Sri Sabzi', 'Nagar Chai', 'Metro Bazaar'];

export const BUS_NAMES = ['Ring Connector', 'Market Link', 'Station Shuttle', 'Lakeside Loop', 'Tech Park Express', 'University Line', 'Old Town Circular', 'Hospital Link'];
export const METRO_NAMES = ['Green Line', 'Amber Line', 'Blue Line', 'Violet Line'];
