// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  outDir: './dist',
  integrations: [
      starlight({
          title: 'Quern',
          favicon: '/favicon.png',
          logo: {
              src: './src/assets/logo.svg',
          },
          social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/quern-dev/quern' }],
          customCss: ['./src/styles/custom.css'],
          components: {
              ThemeSelect: './src/components/ThemeSelect.astro',
          },
          sidebar: [
              {
                  label: 'Getting Started',
                  items: [
                      { label: 'Installation & Setup', slug: 'getting-started/installation-and-setup' },
                      { label: 'Device Pool & Resolution', slug: 'getting-started/device-pool' },
                      { label: 'Build & Install', slug: 'getting-started/build-and-install' },
                      { label: 'App Knowledge Base', slug: 'getting-started/app-knowledge' },
                  ],
              },
              {
                  label: 'iOS',
                  items: [
                      {
                          label: 'Network Proxy',
                          items: [
                              { label: 'Simulator Proxy Setup', slug: 'ios/ios-proxy-simulators' },
                              { label: 'Physical Device Proxy', slug: 'ios/ios-proxy-physical-devices' },
                          ],
                      },
                      {
                          label: 'Logs & Diagnostics',
                          items: [
                              { label: 'Logging Best Practices', slug: 'ios/ios-logging' },
                          ],
                      },
                      {
                          label: 'Physical Devices',
                          items: [
                              { label: 'WebDriverAgent Guide', slug: 'ios/ios-wda' },
                              { label: 'Live Video Preview', slug: 'ios/ios-preview' },
                          ],
                      },
                      {
                          label: 'Simulators',
                          items: [
                              { label: 'App State Management', slug: 'ios/app-state' },
                          ],
                      },
                  ],
              },
              {
                  label: 'Android',
                  items: [
                      { label: 'Getting Started', slug: 'android/android-getting-started' },
                      { label: 'Proxy Setup', slug: 'android/android-proxy' },
                      { label: 'Logcat Integration', slug: 'android/android-logging' },
                  ],
              },
              {
                  label: 'React Native',
                  items: [
                      { label: 'Logging', slug: 'react-native/react-native-logging' },
                  ],
              },
              {
                  label: 'Cross-Platform',
                  items: [
                      { label: 'Network Debugging Patterns', slug: 'cross-platform/network-debugging' },
                  ],
              },
              {
                  label: 'Workflow Guides',
                  items: [
                      { label: 'Testing a New API', slug: 'workflows/workflow-api-testing' },
                      { label: 'Investigating a Crash', slug: 'workflows/workflow-crash-investigation' },
                      { label: 'Multi-Device Testing', slug: 'workflows/workflow-multi-device' },
                      { label: 'Physical Device Setup', slug: 'workflows/workflow-physical-device-setup' },
                      { label: 'Onboarding onto a Project', slug: 'workflows/workflow-onboarding' },
                      { label: 'Location Simulation', slug: 'workflows/workflow-location-testing' },
                      { label: 'Agent-Generated Test Scripts', slug: 'workflows/workflow-test-scripts' },
                      { label: 'Building an App Knowledge Base', slug: 'workflows/workflow-app-knowledge' },
                  ],
              },
          ],
      }),
	],
});