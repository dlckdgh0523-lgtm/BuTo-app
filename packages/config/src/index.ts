export const productConfig = {
  appName: "BUTO",
  rulesVersion: "2026-03-09.v1",
  faceAuthWindowMinutes: 5,
  sensitiveReauthWindowMinutes: 60,
  locationLogIntervalMinutes: 5,
  nearbyRadiusKm: 5,
  autoConfirmMinutes: {
    walk: 30,
    vehicle: 120,
    truck_1t_plus: 360
  }
} as const;
