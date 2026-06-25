import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: { baseURL: 'http://localhost:3000', headless: true },
  projects: [
    // Browsers
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    // Viewports
    { name: 'mobile-chrome',  use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari',  use: { ...devices['iPhone 12'] } },
    { name: 'tablet',         use: { ...devices['iPad (gen 7)'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      // Provide a dummy contract address so the form renders in tests.
      // Without this CONTRACT_ID is empty and the app shows ContractConfigError.
      NEXT_PUBLIC_CONTRACT_ID:
        process.env.NEXT_PUBLIC_CONTRACT_ID ??
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    },
  },
});
