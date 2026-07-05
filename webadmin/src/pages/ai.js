import { StubPage } from '../components/StubPage.js'
export const meta = { layout: 'menu', title: 'AI' }
export default () =>
  StubPage({
    eyebrow: 'ai',
    title: 'AI & agents',
    blurb: 'Expose your data to agents over MCP, and mint the tokens that scope what they can touch.',
    planned: ['MCP server status', 'Token + scope minting', 'Per-collection tool catalog', 'Connect-your-agent config', 'Vector field overview'],
  })
