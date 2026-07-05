import { StubPage } from '../components/StubPage.js'
export const meta = { layout: 'menu', title: 'Realtime' }
export default () =>
  StubPage({
    eyebrow: 'realtime',
    title: 'Realtime',
    blurb: 'A live inspector for everything flowing over sockets right now.',
    planned: ['Active subscriptions', 'Presence channels', 'Live event stream'],
  })
