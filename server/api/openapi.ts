/**
 * Greenhouse Monitoring API - OpenAPI Specification
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Greenhouse Monitoring API',
    version: '2.0.0',
    description: `
RESTful API for the IoT Greenhouse Monitoring System.

## Overview
A mobile PWA connects to an ESP32 via Bluetooth Low Energy (BLE), reads real-time
soil moisture, and syncs stored history from the device's LittleFS to this API.

## Hardware
- **Microcontroller**: ESP32 Dev Kit
- **Sensor**: Capacitive Soil Moisture Sensor via ADS1115 (16-bit ADC, I2C)
- **Connectivity**: BLE GATT → mobile PWA → cloud

## Alerting
When soil moisture drops below 40%, the server dispatches a notification via the
configured webhook (Telegram/WhatsApp).
    `.trim(),
  },
  servers: [{ url: '/', description: 'Production server' }],
  paths: {
    '/api/telemetry': {
      post: {
        tags: ['Telemetry'],
        summary: 'Submit a telemetry reading',
        description: 'Ingest a soil moisture reading relayed from the ESP32 via the mobile PWA.',
        operationId: 'submitTelemetry',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['soilMoisture'],
                properties: {
                  soilMoisture: {
                    type: 'number',
                    format: 'float',
                    description: 'Soil moisture percentage',
                    example: 55.0,
                    minimum: 0,
                    maximum: 100,
                  },
                  recordedAt: {
                    type: 'string',
                    format: 'date-time',
                    description: 'ISO 8601 timestamp from ESP32 (omit for real-time readings)',
                    example: '2026-06-25T10:00:00Z',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Telemetry recorded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Record ID' },
                    message: { type: 'string', example: 'Telemetry recorded' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid payload' },
          '500': { description: 'Server error' },
        },
      },
      get: {
        tags: ['Telemetry'],
        summary: 'Retrieve telemetry history',
        description: 'Fetch historical soil moisture readings, ordered most recent first.',
        operationId: 'getTelemetry',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Number of records to return (max 1000)',
            schema: { type: 'integer', default: 50, minimum: 1, maximum: 1000 },
          },
        ],
        responses: {
          '200': {
            description: 'Array of telemetry records',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      soilMoisture: { type: 'number', format: 'float' },
                      recordedAt: { type: 'string', format: 'date-time', nullable: true },
                      createdAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/telemetry/batch': {
      post: {
        tags: ['Telemetry'],
        summary: 'Bulk-insert synced history from ESP32',
        description: 'Upload up to 500 soil moisture readings synced from ESP32 LittleFS via BLE.',
        operationId: 'submitTelemetryBatch',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['readings'],
                properties: {
                  readings: {
                    type: 'array',
                    maxItems: 500,
                    items: {
                      type: 'object',
                      required: ['soilMoisture'],
                      properties: {
                        soilMoisture: {
                          type: 'number',
                          format: 'float',
                          minimum: 0,
                          maximum: 100,
                        },
                        recordedAt: {
                          type: 'string',
                          format: 'date-time',
                          description: 'Original ESP32 measurement timestamp',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Batch recorded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer', description: 'Number of records inserted' },
                    message: { type: 'string', example: 'Batch recorded' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid payload' },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/relay': {
      get: {
        tags: ['Relay'],
        summary: 'List water-pump relays',
        description:
          'Returns the relay channels and their current on/off state. Seeds the configured channels on first call.',
        operationId: 'getRelays',
        responses: {
          '200': {
            description: 'Array of relays',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      channel: { type: 'integer' },
                      name: { type: 'string' },
                      isOn: { type: 'boolean' },
                      updatedAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Relay'],
        summary: 'Set a relay state',
        description:
          'Persists a relay on/off state and appends an actuation log entry. The single-active interlock is a UI concern; this endpoint records whatever it is told.',
        operationId: 'setRelay',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['channel', 'isOn'],
                properties: {
                  channel: { type: 'integer', example: 1 },
                  isOn: { type: 'boolean', example: true },
                  source: {
                    type: 'string',
                    enum: ['manual', 'schedule', 'device'],
                    default: 'manual',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated relay list' },
          '400': { description: 'Invalid payload' },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/schedule': {
      get: {
        tags: ['Relay'],
        summary: 'List watering schedules',
        operationId: 'getSchedules',
        parameters: [
          {
            name: 'channel',
            in: 'query',
            description: 'Filter to a single relay channel',
            schema: { type: 'integer' },
          },
        ],
        responses: { '200': { description: 'Array of schedules' } },
      },
      post: {
        tags: ['Relay'],
        summary: 'Create a watering schedule',
        operationId: 'createSchedule',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['relayChannel', 'startTime', 'durationMinutes'],
                properties: {
                  relayChannel: { type: 'integer', example: 1 },
                  startTime: { type: 'string', example: '06:30', description: '"HH:MM" 24h local' },
                  durationMinutes: { type: 'integer', example: 15, minimum: 1, maximum: 1440 },
                  daysOfWeek: {
                    type: 'array',
                    items: { type: 'integer', minimum: 0, maximum: 6 },
                    description: '0=Sun..6=Sat, defaults to every day',
                  },
                  enabled: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Schedule created' },
          '400': { description: 'Invalid payload' },
        },
      },
    },
    '/api/schedule/{id}': {
      patch: {
        tags: ['Relay'],
        summary: 'Update a schedule',
        description: 'Update any subset of schedule fields (commonly toggles `enabled`).',
        operationId: 'updateSchedule',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Updated schedule' },
          '400': { description: 'Invalid payload' },
          '404': { description: 'Schedule not found' },
        },
      },
      delete: {
        tags: ['Relay'],
        summary: 'Delete a schedule',
        operationId: 'deleteSchedule',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Schedule deleted' },
          '404': { description: 'Schedule not found' },
        },
      },
    },
    '/api/actuation': {
      get: {
        tags: ['Relay'],
        summary: 'Relay actuation history',
        description: 'Returns on/off events newest first.',
        operationId: 'getActuationLog',
        parameters: [
          { name: 'channel', in: 'query', schema: { type: 'integer' } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 100, minimum: 1, maximum: 500 },
          },
        ],
        responses: { '200': { description: 'Array of actuation log entries' } },
      },
    },
  },
  tags: [
    { name: 'Telemetry', description: 'Soil moisture sensor data operations' },
    { name: 'Relay', description: 'Water-pump relay control and scheduling' },
  ],
} as const
