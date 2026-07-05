import { StubPage } from '../components/StubPage.js'
export const meta = { layout: 'menu', title: 'Files' }
export default () =>
  StubPage({
    eyebrow: 'files',
    title: 'Files',
    blurb: 'Where uploads live and how they are served.',
    planned: ['Storage driver (local / S3 / R2)', 'File fields', 'Image transforms', 'Uploads browser'],
  })
