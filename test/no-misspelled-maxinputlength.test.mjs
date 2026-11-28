// The Wiro AI catalog names the file limit of a file input maxinputlength. Its old, misspelled name
// is gone from the API, so no tracked file may bring it back. The needle is built from two parts so
// that this file does not match itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const misspelled = 'maxinput' + 'lenght';

test('no tracked file uses the misspelled name of maxinputlength', () => {
	const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
		.split('\0')
		.filter(
			(file) => file !== '' && statSync(join(root, file), { throwIfNoEntry: false })?.isFile(),
		);
	const found = files.filter((file) =>
		readFileSync(join(root, file), 'latin1').toLowerCase().includes(misspelled),
	);
	assert.deepEqual(found, []);
});
