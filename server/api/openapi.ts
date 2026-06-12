/**
 * Greenhouse Monitoring API - OpenAPI Specification
 *
 * This file defines the REST API contract for the IoT Greenhouse Monitoring System.
 * It is served as JSON via /api/openapi.json for Scalar documentation.
 */

/**
 * Returns the OpenAPI specification as a JSON object.
 * Used by Nuxt server route to serve the spec to Scalar.
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Greenhouse Monitoring API',
    version: '1.0.0',
    description: `
RESTful API for the IoT Greenhouse Monitoring System.

## Overview
This API enables IoT devices (ESP32) to submit environmental telemetry data
and provides historical data retrieval for the web dashboard.

## Hardware
- **Microcontroller**: ESP32 Dev Kit
- **Sensors**: DHT22 (temperature & humidity), Capacitive Soil Moisture Sensor
- **ADC**: ADS1115 16-bit external ADC (I2C)
- **Display**: OLED 128x64 (I2C)

## Alerting
When soil moisture drops below 40%, the server automatically dispatches
a notification via the configured messaging channel (Telegram/WhatsApp).
    `.trim(),
    contact: {
      name: 'Greenhouse Team',
    },
  },
  servers: [
    {
      url: '/',
      description: 'Production server',
    },
  ],
  paths: {
    '/api/telemetry': {
      post: {
        tags: ['Telemetry'],
        summary: 'Submit telemetry data',
        description: 'Ingest environmental sensor readings from the greenhouse IoT device.',
        operationId: 'submitTelemetry',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['temperature', 'humidity', 'soilMoisture'],
                properties: {
                  temperature: {
                    type: 'number',
                    format: 'float',
                    description: 'Air temperature in Celsius',
                    example: 28.5,
                    minimum: -40,
                    maximum: 80,
                  },
                  humidity: {
                    type: 'number',
                    format: 'float',
                    description: 'Air humidity in percentage (%)',
                    example: 65.2,
                    minimum: 0,
                    maximum: 100,
                  },
                  soilMoisture: {
                    type: 'number',
                    format: 'float',
                    description: 'Soil moisture in percentage (%)',
                    example: 55.0,
                    minimum: 0,
                    maximum: 100,
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Telemetry data successfully recorded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer', description: 'Record ID' },
                    message: { type: 'string', example: 'Telemetry recorded' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid payload - missing or invalid fields',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    details: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          '500': {
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        'x-alerting': {
          description: 'If soilMoisture < 40%, the server dispatches a notification via messaging API.',
        },
      },
      get: {
        tags: ['Telemetry'],
        summary: 'Retrieve telemetry history',
        description: 'Fetch historical sensor readings. Ordered by most recent first.',
        operationId: 'getTelemetry',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Number of records to return (max 1000)',
            schema: {
              type: 'integer',
              default: 50,
              minimum: 1,
              maximum: 1000,
            },
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
                      id: { type: 'integer' },
                      temperature: { type: 'number', format: 'float' },
                      humidity: { type: 'number', format: 'float' },
                      soilMoisture: { type: 'number', format: 'float' },
                      createdAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
          '500': {
            description: 'Server error',
          },
        },
      },
    },
  },
  tags: [
    {
      name: 'Telemetry',
      description: 'Environmental sensor data operations',
    },
  ],
} as const
