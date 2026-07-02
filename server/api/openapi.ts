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
  },
  tags: [{ name: 'Telemetry', description: 'Soil moisture sensor data operations' }],
} as const
