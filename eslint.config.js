/** Regras mínimas: pegar erro de verdade, não discutir estilo (isso é do Prettier). */
export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        // navegador
        window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
        localStorage: 'readonly', history: 'readonly', crypto: 'readonly', performance: 'readonly',
        fetch: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly', MediaStream: 'readonly', RTCPeerConnection: 'readonly',
        RTCRtpSender: 'readonly', WebSocket: 'readonly', AudioWorkletNode: 'readonly',
        HTMLMediaElement: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        TextEncoder: 'readonly', Element: 'readonly', BarcodeDetector: 'readonly',
        confirm: 'readonly', prompt: 'readonly', alert: 'readonly', getComputedStyle: 'readonly',
        // worklet
        AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly',
        currentTime: 'readonly', sampleRate: 'readonly',
        // node
        process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', require: 'readonly',
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-implicit-coercion': 'off',
    },
  },
  { ignores: ['node_modules/**'] },
];
