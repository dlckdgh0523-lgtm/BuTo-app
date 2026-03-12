import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "buto-miniapp",
  brand: {
    displayName: "부토",
    primaryColor: "#3182f6",
    icon: "https://static.toss.im/icons/png/4x/icon-toss.png"
  },
  web: {
    host: "localhost",
    port: 3000,
    commands: {
      dev: "pnpm dev",
      build: "pnpm build"
    }
  },
  webViewProps: {
    type: "partner",
    pullToRefreshEnabled: true,
    overScrollMode: "never",
    allowsBackForwardNavigationGestures: false
  },
  navigationBar: {
    withBackButton: true,
    withHomeButton: true
  },
  permissions: [
    { name: "geolocation", access: "access" },
    { name: "camera", access: "access" },
    { name: "photos", access: "read" }
  ],
  outdir: "dist"
});
