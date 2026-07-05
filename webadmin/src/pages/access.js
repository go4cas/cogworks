import { StubPage } from '../components/StubPage.js'
export const meta = { layout: 'menu', title: 'Access' }
export default () =>
  StubPage({
    eyebrow: 'access',
    title: 'Access',
    blurb: 'Who can reach the machine — the humans, the tokens, and the operators who run it.',
    planned: ['Users per auth collection', 'Auth methods & providers', 'API tokens + scopes', 'Operator roles editor', 'Impersonation'],
  })
