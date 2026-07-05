import { StubPage } from '../components/StubPage.js'
export const meta = { layout: 'menu', title: 'Observe' }
export default () =>
  StubPage({
    eyebrow: 'observe',
    title: 'Observe',
    blurb: 'What the machine is doing, and what it did.',
    planned: ['Logs', 'Metrics', 'Health', 'Audit log', 'Queue & job dashboard', 'Dead-letter replay'],
  })
