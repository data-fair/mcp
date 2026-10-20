import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prepareEditorSchema } from './editor-schema.ts'

describe('prepareEditorSchema', () => {
  it('prepares a dataset line schema the way data-fair\'s form does', async () => {
    const input: any = {
      type: 'object',
      properties: {
        title: { type: 'string', layout: 'textarea' },
        file: { type: 'string', 'x-refersTo': 'http://schema.org/DigitalDocument' },
        link: { type: 'string', 'x-refersTo': 'http://schema.org/DigitalDocument', layout: 'text-field' },
        geo: { type: 'string', 'x-extension': 'geocoder' }
      }
    }
    const out: any = await prepareEditorSchema(input)
    assert.deepEqual(out.properties.title.layout, { comp: 'textarea' })
    assert.equal(out.properties.file.layout.comp, 'none')
    assert.equal(out.properties.link.layout.comp, 'text-field')
    assert.equal(out.properties.geo.layout.comp, 'none')
    assert.equal(input.properties.title.layout, 'textarea', 'input untouched')
  })
})
