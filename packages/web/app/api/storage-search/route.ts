import { NextRequest, NextResponse } from 'next/server';
import { StorageSearchRequest, StorageSearchResponse, StorageFacility, StorageUnit } from '@/lib/types';

// Mock storage facilities data (US self-storage typical)
const MOCK_FACILITIES: StorageFacility[] = [
  {
    id: 'fac-1',
    name: 'SecureStore Downtown',
    address: '123 Main St, Downtown',
    distance_km: null,
    rating: 4.5,
    units: [
      { id: 'u1-1', name: '5x5 Small', width_cm: 152, depth_cm: 152, height_cm: 244, volume_m3: 5.6, price_monthly: 59, available: true },
      { id: 'u1-2', name: '5x10 Medium', width_cm: 152, depth_cm: 305, height_cm: 244, volume_m3: 11.3, price_monthly: 99, available: true },
      { id: 'u1-3', name: '10x10 Large', width_cm: 305, depth_cm: 305, height_cm: 244, volume_m3: 22.7, price_monthly: 159, available: true },
      { id: 'u1-4', name: '10x20 XL', width_cm: 305, depth_cm: 610, height_cm: 244, volume_m3: 45.3, price_monthly: 259, available: false },
    ],
  },
  {
    id: 'fac-2',
    name: 'EZ Storage Plus',
    address: '456 Oak Ave, Midtown',
    distance_km: null,
    rating: 4.2,
    units: [
      { id: 'u2-1', name: 'Locker', width_cm: 91, depth_cm: 91, height_cm: 183, volume_m3: 1.5, price_monthly: 35, available: true },
      { id: 'u2-2', name: '5x5 Climate', width_cm: 152, depth_cm: 152, height_cm: 244, volume_m3: 5.6, price_monthly: 79, available: true },
      { id: 'u2-3', name: '5x10 Climate', width_cm: 152, depth_cm: 305, height_cm: 244, volume_m3: 11.3, price_monthly: 129, available: true },
      { id: 'u2-4', name: '10x15', width_cm: 305, depth_cm: 457, height_cm: 244, volume_m3: 34.0, price_monthly: 199, available: true },
    ],
  },
  {
    id: 'fac-3',
    name: 'Budget Self Storage',
    address: '789 Industrial Blvd',
    distance_km: null,
    rating: 3.8,
    units: [
      { id: 'u3-1', name: '5x5 Basic', width_cm: 152, depth_cm: 152, height_cm: 213, volume_m3: 4.9, price_monthly: 49, available: true },
      { id: 'u3-2', name: '5x10 Basic', width_cm: 152, depth_cm: 305, height_cm: 213, volume_m3: 9.9, price_monthly: 79, available: true },
      { id: 'u3-3', name: '10x10 Basic', width_cm: 305, depth_cm: 305, height_cm: 213, volume_m3: 19.8, price_monthly: 129, available: true },
      { id: 'u3-4', name: '10x20 Basic', width_cm: 305, depth_cm: 610, height_cm: 213, volume_m3: 39.6, price_monthly: 199, available: true },
      { id: 'u3-5', name: '10x30 Garage', width_cm: 305, depth_cm: 914, height_cm: 274, volume_m3: 76.5, price_monthly: 299, available: true },
    ],
  },
  {
    id: 'fac-4',
    name: 'Premium Storage Co',
    address: '321 Luxury Lane, Uptown',
    distance_km: null,
    rating: 4.9,
    units: [
      { id: 'u4-1', name: '5x5 Premium', width_cm: 152, depth_cm: 152, height_cm: 274, volume_m3: 6.3, price_monthly: 89, available: true },
      { id: 'u4-2', name: '5x10 Premium', width_cm: 152, depth_cm: 305, height_cm: 274, volume_m3: 12.7, price_monthly: 149, available: false },
      { id: 'u4-3', name: '10x10 Premium', width_cm: 305, depth_cm: 305, height_cm: 274, volume_m3: 25.5, price_monthly: 229, available: true },
      { id: 'u4-4', name: '10x15 Premium', width_cm: 305, depth_cm: 457, height_cm: 274, volume_m3: 38.2, price_monthly: 299, available: true },
    ],
  },
  {
    id: 'fac-5',
    name: 'QuickPark Storage',
    address: '555 Commerce Dr',
    distance_km: null,
    rating: 4.0,
    units: [
      { id: 'u5-1', name: 'Mini Locker', width_cm: 61, depth_cm: 61, height_cm: 122, volume_m3: 0.45, price_monthly: 25, available: true },
      { id: 'u5-2', name: 'Standard Locker', width_cm: 91, depth_cm: 122, height_cm: 183, volume_m3: 2.0, price_monthly: 45, available: true },
      { id: 'u5-3', name: '5x5', width_cm: 152, depth_cm: 152, height_cm: 244, volume_m3: 5.6, price_monthly: 69, available: true },
      { id: 'u5-4', name: '5x10', width_cm: 152, depth_cm: 305, height_cm: 244, volume_m3: 11.3, price_monthly: 109, available: true },
      { id: 'u5-5', name: '10x10', width_cm: 305, depth_cm: 305, height_cm: 244, volume_m3: 22.7, price_monthly: 169, available: true },
    ],
  },
];

/**
 * Check if a storage unit fits the object
 * Direct fit OR volume fit with 1.25x padding
 */
function unitFits(
  unit: StorageUnit,
  obj: { width_cm: number; depth_cm: number; height_cm: number; volume_m3: number }
): boolean {
  // Direct dimension fit (object must fit inside unit)
  const directFit =
    unit.width_cm >= obj.width_cm &&
    unit.depth_cm >= obj.depth_cm &&
    unit.height_cm >= obj.height_cm;

  // Volume fit with 1.25x padding factor
  const volumeFit = unit.volume_m3 >= obj.volume_m3 * 1.25;

  return directFit || volumeFit;
}

/**
 * Generate mock distance based on radius
 */
function generateMockDistance(radiusKm: number): number {
  return Math.random() * radiusKm;
}

export async function POST(request: NextRequest): Promise<NextResponse<StorageSearchResponse>> {
  try {
    const body: StorageSearchRequest = await request.json();

    const {
      width_cm,
      depth_cm,
      height_cm,
      volume_m3,
      radius_km,
      user_location,
    } = body;

    // Process facilities
    let facilities = MOCK_FACILITIES.map((facility) => {
      // Generate mock distance
      const distance_km = user_location
        ? generateMockDistance(radius_km)
        : null;

      // Filter to only units that have at least one fitting option
      // (we return all units but the client shows which fit)
      return {
        ...facility,
        distance_km,
      };
    });

    // Sort by distance (if available) or rating
    facilities.sort((a, b) => {
      if (a.distance_km !== null && b.distance_km !== null) {
        return a.distance_km - b.distance_km;
      }
      return b.rating - a.rating;
    });

    // Filter facilities within radius (mock: always include all but vary distance)
    if (user_location) {
      facilities = facilities.filter(
        (f) => f.distance_km !== null && f.distance_km <= radius_km
      );
    }

    // Check if any facility has fitting units
    const hasFittingUnits = facilities.some((facility) =>
      facility.units.some((unit) =>
        unitFits(unit, { width_cm, depth_cm, height_cm, volume_m3 })
      )
    );

    // If no fitting units found, we still return facilities
    // The client will show "no fit" badges

    const response: StorageSearchResponse = {
      facilities,
      object_dimensions: {
        width_cm,
        depth_cm,
        height_cm,
        volume_m3,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Storage search error:', error);
    return NextResponse.json(
      {
        facilities: [],
        object_dimensions: { width_cm: 0, depth_cm: 0, height_cm: 0, volume_m3: 0 },
      },
      { status: 500 }
    );
  }
}
