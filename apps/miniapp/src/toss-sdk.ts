const ONE_TOUCH_MIN_VERSION = "5.236.0";

export type TossPermissionStatus = "notDetermined" | "denied" | "allowed";
export type TossLocationAccuracy = 1 | 2 | 3 | 4 | 5 | 6;

interface TossLoginResult {
  authorizationCode: string;
  referrer: "DEFAULT" | "SANDBOX";
}

interface TossCertRequestParams {
  txId: string;
  skipConfirmDoc?: boolean;
}

interface TossImageResponse {
  id: string;
  dataUri: string;
}

interface TossLocationResponse {
  timestamp: number;
  accessLocation?: "FINE" | "COARSE";
  coords: {
    latitude: number;
    longitude: number;
    altitude: number;
    accuracy: number;
    altitudeAccuracy: number;
    heading: number;
  };
}

interface PermissionCapable<T extends (...args: any[]) => Promise<any>> {
  (...args: Parameters<T>): ReturnType<T>;
  getPermission(): Promise<TossPermissionStatus>;
  openPermissionDialog(): Promise<Exclude<TossPermissionStatus, "notDetermined">>;
}

interface TossWebFrameworkModule {
  appLogin(): Promise<TossLoginResult>;
  appsInTossSignTossCert(params: TossCertRequestParams): Promise<unknown>;
  getTossAppVersion?(): Promise<string | undefined>;
  checkoutPayment(params: { params: { payToken: string } }): Promise<{ success: boolean; reason?: string }>;
  getCurrentLocation: PermissionCapable<(options: { accuracy: TossLocationAccuracy }) => Promise<TossLocationResponse>>;
  openCamera: PermissionCapable<(options?: { base64?: boolean; maxWidth?: number }) => Promise<TossImageResponse>>;
  fetchAlbumPhotos: PermissionCapable<(options?: { maxCount?: number; maxWidth?: number; base64?: boolean }) => Promise<TossImageResponse[]>>;
  openURL?: (url: string) => Promise<unknown>;
  startUpdateLocation(params: {
    options: { accuracy: TossLocationAccuracy; timeInterval: number; distanceInterval: number };
    onEvent(location: TossLocationResponse): void;
    onError(error: unknown): void;
  }): () => void;
}

export interface TossSdkAvailability {
  available: boolean;
  appVersion?: string;
  supportsOneTouch: boolean;
}

export interface TossCapturedImage {
  id: string;
  dataUri: string;
}

export interface TossLocationSnapshot {
  timestamp: number;
  accuracy: number;
  lat: number;
  lng: number;
}

async function loadSdk(): Promise<TossWebFrameworkModule> {
  return (await import("@apps-in-toss/web-framework")) as unknown as TossWebFrameworkModule;
}

export async function detectTossSdkAvailability(): Promise<TossSdkAvailability> {
  try {
    const sdk = await loadSdk();
    const appVersion = typeof sdk.getTossAppVersion === "function" ? await sdk.getTossAppVersion() : undefined;
    return {
      available: true,
      appVersion,
      supportsOneTouch: !appVersion || compareVersion(appVersion, ONE_TOUCH_MIN_VERSION) >= 0
    };
  } catch {
    return {
      available: false,
      supportsOneTouch: false
    };
  }
}

export async function startAppsInTossLogin() {
  const sdk = await loadSdk();
  return sdk.appLogin();
}

export async function openTossOneTouch(txId: string) {
  const sdk = await loadSdk();
  return sdk.appsInTossSignTossCert({
    txId,
    skipConfirmDoc: true
  });
}

export async function checkoutTossPayment(payToken: string) {
  const sdk = await loadSdk();
  return sdk.checkoutPayment({
    params: {
      payToken
    }
  });
}

export async function getLocationPermission() {
  const sdk = await loadSdk();
  return sdk.getCurrentLocation.getPermission();
}

export async function openLocationPermissionDialog() {
  const sdk = await loadSdk();
  return sdk.getCurrentLocation.openPermissionDialog();
}

export async function getCameraPermission() {
  const sdk = await loadSdk();
  return sdk.openCamera.getPermission();
}

export async function openCameraPermissionDialog() {
  const sdk = await loadSdk();
  return sdk.openCamera.openPermissionDialog();
}

export async function getPhotosPermission() {
  const sdk = await loadSdk();
  return sdk.fetchAlbumPhotos.getPermission();
}

export async function openPhotosPermissionDialog() {
  const sdk = await loadSdk();
  return sdk.fetchAlbumPhotos.openPermissionDialog();
}

export async function readCurrentLocation(accuracy: TossLocationAccuracy = 3): Promise<TossLocationSnapshot> {
  const sdk = await loadSdk();
  const response = await sdk.getCurrentLocation({ accuracy });
  return normalizeLocation(response);
}

export async function captureCameraImage(options?: { maxWidth?: number }) {
  const sdk = await loadSdk();
  return sdk.openCamera({
    base64: false,
    maxWidth: options?.maxWidth ?? 1280
  });
}

export async function fetchRecentAlbumPhotos(options?: { maxCount?: number; maxWidth?: number }) {
  const sdk = await loadSdk();
  return sdk.fetchAlbumPhotos({
    base64: false,
    maxCount: options?.maxCount ?? 4,
    maxWidth: options?.maxWidth ?? 1280
  });
}

export async function startLocationUpdates(input: {
  accuracy?: TossLocationAccuracy;
  timeInterval: number;
  distanceInterval: number;
  onLocation(location: TossLocationSnapshot): void;
  onError(error: unknown): void;
}) {
  const sdk = await loadSdk();
  return sdk.startUpdateLocation({
    options: {
      accuracy: input.accuracy ?? 3,
      timeInterval: input.timeInterval,
      distanceInterval: input.distanceInterval
    },
    onEvent(location) {
      input.onLocation(normalizeLocation(location));
    },
    onError(error) {
      input.onError(error);
    }
  });
}

export async function openExternalUrl(url: string) {
  const sdk = await loadSdk();
  if (typeof sdk.openURL === "function") {
    return sdk.openURL(url);
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function normalizeLocation(response: TossLocationResponse): TossLocationSnapshot {
  return {
    timestamp: response.timestamp,
    accuracy: response.coords.accuracy,
    lat: response.coords.latitude,
    lng: response.coords.longitude
  };
}

function compareVersion(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}
