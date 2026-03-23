import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatTextOutput } from './_utils.ts'

describe('formatTextOutput', () => {
  it('should join non-empty sections with blank lines', () => {
    const result = formatTextOutput(['Header', '', 'Body', 'Footer'])
    assert.equal(result, 'Header\n\nBody\n\nFooter')
  })

  it('should filter out empty sections', () => {
    const result = formatTextOutput(['Header', '', 'Footer'])
    assert.equal(result, 'Header\n\nFooter')
  })
})
