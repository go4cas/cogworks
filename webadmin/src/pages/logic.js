import { StubPage } from '../components/StubPage.js'
export const meta = { layout: 'menu', title: 'Logic' }
export default () =>
  StubPage({
    eyebrow: 'logic',
    title: 'Logic',
    blurb: 'The moving parts — code that runs on events, schedules, and requests.',
    planned: ['Hooks', 'Custom routes', 'Cron + one-off jobs', 'Workers', 'Durable workflows', 'Webhooks', 'Feature flags'],
  })
