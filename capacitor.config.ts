import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.schoolie.tracker',
  appName: 'Project Cost Tracker',
  webDir: 'dist',
  server: {
    // Allow OTA / HTTPS calls to the home PC update server
    cleartext: true,
    androidScheme: 'https',
  },
  plugins: {
    CapacitorUpdater: {
      // We drive updates ourselves against the home PC server
      autoUpdate: false,
      appReadyTimeout: 12000,
      // Keep default bundle if download fails
      resetWhenUpdateFails: true,
    },
  },
}

export default config
