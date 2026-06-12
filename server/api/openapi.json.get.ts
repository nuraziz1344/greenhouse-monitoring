import { openApiSpec } from './openapi'

/**
 * Serves the OpenAPI specification for Scalar documentation.
 * GET /api/openapi.json
 */
export default defineEventHandler(() => {
  return openApiSpec
})
