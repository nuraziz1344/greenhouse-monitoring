<script setup lang="ts">
// Full-screen docs — skip the dashboard layout
definePageMeta({ layout: false })

useHead({ title: 'API Docs — Greenhouse Monitor' })

onMounted(() => {
  const script = document.createElement('script')
  script.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference'
  script.onload = () => {
    // @ts-expect-error — Scalar global injected by the standalone bundle
    Scalar.createApiReference('#scalar-docs', {
      url: '/api/openapi.json',
      darkMode: true,
      hideModels: true,
      hideDownloadButton: true,
    })
  }
  document.body.appendChild(script)
})
</script>

<template>
  <div id="scalar-docs" />
</template>
