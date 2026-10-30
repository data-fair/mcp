import type { JsonSchema } from '@data-fair/openapi-mcp'

const ATTACHMENT = 'http://schema.org/DigitalDocument'

/**
 * Turn a schema fetched from an API into one the editor compiles, the way data-fair's own
 * line-editing form does before handing it to json-layout.
 *
 * Four steps, all of them load-bearing:
 * - `v2compat`, because dataset schemas carry vjsf-v2 keywords and compiling them raw
 *   renders pickers as plain sections while `getFieldSuggestions` refuses them;
 * - a string `layout` is shorthand for `{ comp }`, which the compat layer leaves as it
 *   found it;
 * - attachment and extension columns are hidden: an agent has no file to upload, and
 *   extension columns are computed by the API, so writing them is meaningless;
 * - the form is closed to its columns: a line read back for editing also carries _id,
 *   _updatedAt, _i and the nested extension results, which the line write refuses as
 *   additional properties. json-layout drops what the schema refuses, as data-fair's own
 *   form sends only the writable columns.
 */
export async function prepareEditorSchema (fetched: JsonSchema): Promise<JsonSchema> {
  const { v2compat } = await import('@json-layout/core/compat/v2')
  const schema: JsonSchema = v2compat(structuredClone(fetched))
  schema.additionalProperties = false

  for (const property of Object.values<any>(schema.properties ?? {})) {
    if (typeof property.layout === 'string') property.layout = { comp: property.layout }
    const hide = (property['x-refersTo'] === ATTACHMENT && property.layout?.comp !== 'text-field') ||
      property['x-extension'] !== undefined
    if (hide) property.layout = { ...(property.layout ?? {}), comp: 'none' }
  }
  return schema
}
