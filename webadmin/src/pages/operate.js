import { StubPage } from '../components/StubPage.js'
export const meta = { layout: 'menu', title: 'Settings' }
export default () =>
  StubPage({
    eyebrow: 'operate',
    title: 'Settings',
    blurb: 'Configuration, backups, and the levers you pull to keep it running.',
    planned: ['Settings panels', 'Backup / restore & snapshots', 'Key rotation', 'Rate limits', 'Static hosting', 'Updates'],
  })
