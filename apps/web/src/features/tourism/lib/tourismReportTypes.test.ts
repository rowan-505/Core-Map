import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TOURISM_REPORT_TYPE_OPTIONS } from './tourismReportTypes.ts';

describe('tourism report UI options', () => {
  it('covers required tourism report cases without a parallel system', () => {
    const codes = TOURISM_REPORT_TYPE_OPTIONS.map((option) => option.code);
    assert.ok(codes.includes('tourism_incorrect_type'));
    assert.ok(codes.includes('tourism_incorrect_description'));
    assert.ok(codes.includes('tourism_incorrect_price'));
    assert.ok(codes.includes('closed_or_removed'));
    assert.ok(codes.includes('duplicate_item'));
    assert.ok(codes.includes('tourism_incorrect_review'));
    assert.ok(codes.includes('tourism_other'));
  });
});
