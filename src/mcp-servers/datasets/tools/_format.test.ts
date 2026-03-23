import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toCSV, formatTextOutput } from './_utils.ts'

describe('toCSV', () => {
  it('should convert rows to CSV with header', () => {
    const rows = [
      { nom: 'Jean Dupont', ville: 'Paris', age: 42 },
      { nom: 'Marie Martin', ville: 'Lyon', age: 35 }
    ]
    const result = toCSV(rows)
    assert.equal(result, 'nom,ville,age\nJean Dupont,Paris,42\nMarie Martin,Lyon,35\n')
  })

  it('should escape values with commas', () => {
    const rows = [{ name: 'Dupont, Jean', city: 'Paris' }]
    const result = toCSV(rows)
    assert.equal(result, 'name,city\n"Dupont, Jean",Paris\n')
  })

  it('should escape values with quotes', () => {
    const rows = [{ name: 'He said "hello"', city: 'Paris' }]
    const result = toCSV(rows)
    assert.equal(result, 'name,city\n"He said ""hello""",Paris\n')
  })

  it('should return empty string for empty rows', () => {
    assert.equal(toCSV([]), '')
  })
})

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
