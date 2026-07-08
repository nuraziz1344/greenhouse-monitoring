// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-06-12',
  future: { compatibilityVersion: 4 },

  modules: ['@nuxtjs/tailwindcss', '@vite-pwa/nuxt'],

  css: ['~/assets/css/main.css'],

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    config: {
      theme: {
        extend: {
          colors: {
            primary: {
              50: '#ecfdf5',
              100: '#d1fae5',
              200: '#a7f3d0',
              300: '#6ee7b7',
              400: '#34d399',
              500: '#10b981',
              600: '#059669',
              700: '#047857',
              800: '#065f46',
              900: '#064e3b',
            },
          },
        },
      },
    },
  },

  // PWA Configuration
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Greenhouse Monitor',
      short_name: 'GH Monitor',
      description: 'IoT Greenhouse Environmental Monitoring Dashboard',
      theme_color: '#10b981',
      background_color: '#ffffff',
      display: 'standalone',
      orientation: 'portrait-primary',
      icons: [
        {
          src: '/icons/icon-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/icons/icon-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ],
    },
    workbox: {
      navigateFallback: '/',
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB (default is 2 MiB)
    },
    client: {
      installPrompt: true,
    },
  },

  // Nitro server configuration for Vercel deployment
  nitro: {
    preset: 'vercel',
    experimental: {
        openAPI: true
    }
  },

  app: {
    head: {
      title: 'Greenhouse Monitor',
      meta: [
        { name: 'description', content: 'IoT Greenhouse Environmental Monitoring System' },
        { name: 'theme-color', content: '#10b981' },
      ],
    },
  },

  // Runtime configuration
  runtimeConfig: {
    public: {
      telemetryPollInterval: 30_000,
      statusBadgeInterval: 1_000,
      // ESP32 counts as online via WiFi if the newest reading is fresher than
      // this (firmware measures/POSTs every 15 min — allow one missed cycle).
      deviceOnlineThreshold: 35 * 60_000,
      telemetryDefaultRange: '24h', // one of: 1h | 6h | 24h | 7d | all
      ble: {
        deviceName: 'GH-Sensor',
        serviceUuid: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
        realtimeCharUuid: 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
        historyCharUuid: '1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e',
        commandCharUuid: 'a8261b36-3f5e-4a2c-9b1d-2e6f7c8a9b01', // WRITE: relay/schedule commands
      },
      // Water-pump relay channels — seeds Relay rows and labels the UI.
      relayChannels: [
        { channel: 1, name: 'Zone A' },
        { channel: 2, name: 'Zone B' },
        { channel: 3, name: 'Zone C' },
      ],
      relayScheduleCheckInterval: 60_000, // in-app scheduler tick (ms)
    },
  },
})