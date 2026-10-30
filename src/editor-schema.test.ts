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

  // a line read back for editing carries _id, _updatedAt, _i and the nested extension results,
  // which the line write refuses as additional properties (400): the form keeps its own columns only
  it('saves a line loaded for editing without the fields the server manages', async () => {
    const { createFormSession } = await import('@json-layout/agents')
    const schema = await prepareEditorSchema({
      type: 'object',
      properties: { nom: { type: 'string' }, '_code_insee.departement': { type: 'string', 'x-extension': 'dataset:communes/code-insee', readOnly: true } }
    })
    let saved: unknown
    const session = createFormSession({
      title: 'Edit a line',
      schema: async () => ({ schema, version: '1' }),
      load: async () => ({ data: { _id: 'l1', nom: 'Piscine', _updatedAt: '2026-10-28T15:03:54.143Z', _i: 20086869, _code_insee: { departement: '44' } }, version: undefined }),
      save: async (data: unknown) => { saved = data; return { version: undefined } }
    } as any)
    await session.open()
    await session.save()
    assert.deepEqual(saved, { nom: 'Piscine' })
  })
})
