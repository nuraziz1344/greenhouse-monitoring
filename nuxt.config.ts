// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-06-12',
  future: { compatibilityVersion: 4 },

  modules: ['@nuxtjs/tailwindcss', '@vite-pwa/nuxt'],

  css: ['~/assets/css/main.css'],

  // Web Bluetooth type declarations (navigator.bluetooth, GATT types)
  typescript: {
    tsConfig: {
      compilerOptions: {
        types: ['@types/web-bluetooth'],
      },
    },
  },

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
        {
          // Dedicated maskable render (artwork inset on a full-bleed theme-color
          // background) so Android's circle/squircle crop never clips it.
          src: '/icons/icon-maskable-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    // Register the service worker in `nuxt dev` too, so the install prompt and
    // offline caching can be tested locally without a full production build.
    devOptions: {
      enabled: true,
      type: 'module',
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
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icons/icon-192x192.png' },
        { rel: 'apple-touch-icon', sizes: '192x192', href: '/icons/icon-192x192.png' },
      ],
    },
  },

  // Runtime configuration
  runtimeConfig: {
    public: {
      telemetryPollInterval: 30_000,
      statusBadgeInterval: 1_000,
      // ESP32 counts as online via WiFi if the newest reading is fresher than
      // this (firmware measures/POSTs every 15 min + slack for a late post).
      // Override with NUXT_PUBLIC_DEVICE_ONLINE_THRESHOLD (ms).
      deviceOnlineThreshold: 20 * 60_000,
      telemetryDefaultRange: '24h', // one of: 1h | 6h | 24h | 7d | all
      // Physical soil-moisture sensor units. Drives dashboard cards/chart series
      // and validates the optional `sensorId` on telemetry ingestion — see
      // API_INTEGRATION.md §2.1/§2.2. Telemetry rows default to sensorId 1 when
      // omitted, so older single-sensor firmware keeps working unmodified.
      soilSensors: [
        { sensorId: 1, name: 'Sensor 1' },
        { sensorId: 2, name: 'Sensor 2' },
      ],
      ble: {
        deviceName: 'GH-Sensor',
        serviceUuid: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
        realtimeCharUuid: 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
        // WRITE 0x01 = request history dump (streamed back as notifications),
        // WRITE 0x02 = ack upload → device clears its ring buffer.
        historyCharUuid: '1c95d5e3-d8f7-413a-bf3d-7a2e5d7be87e',
        commandCharUuid: 'a8261b36-3f5e-4a2c-9b1d-2e6f7c8a9b01', // WRITE: relay/config commands
        timeSyncCharUuid: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', // WRITE: epoch ms as ASCII
        provisionCharUuid: 'c47d1b6a-9d1e-4f6b-8f2e-3a5c7d9e0f12', // WRITE creds + NOTIFY status
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