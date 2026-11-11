import {defineConfig} from '@playwright/test';
// Start the development server on 5173 before running E2E. Each test has isolated storage.
export default defineConfig({testDir:'./e2e',use:{baseURL:process.env.TEMPO_TEST_URL||'http://localhost:5173',headless:true,channel:'msedge',timezoneId:'Asia/Shanghai'},projects:[...[375,390,430].map(width=>({name:`mobile-${width}`,use:{viewport:{width,height:844}}})),{name:'desktop',use:{viewport:{width:1440,height:1000}}}]});

